// routes/livestock-routes.js
const express = require("express");
const { auditLog } = require("../utils/audit-log");

module.exports = function livestockRoutes({ runPgQuery }) {
  const router = express.Router();

  // ─────────────────────────────────────────
  // 뱃지 목록 (현재 사육두수 포함)
  // GET /api/livestock/batches?status=active|completed|all
  // ─────────────────────────────────────────
  router.get("/batches", async (req, res) => {
    const status = req.query.status || "active";
    try {
      const whereClause =
        status === "all" ? "" : `WHERE b.status = '${status === "completed" ? "completed" : "active"}'`;

      const sql = `
        WITH agg AS (
          SELECT
            e.batch_id,
            COALESCE(SUM(e.transfer_in), 0)::INT  AS total_transfer_in,
            COALESCE(SUM(e.deaths),      0)::INT  AS total_deaths,
            COALESCE(SUM(e.culled),      0)::INT  AS total_culled,
            COALESCE(SUM(e.shipped),     0)::INT  AS total_shipped,
            COALESCE(SUM(e.deducted),    0)::INT  AS total_deducted,
            COALESCE(SUM(e.stock_weight), 0)       AS total_stock_weight,
            MAX(CASE WHEN e.transfer_in > 0 THEN e.event_date END) AS last_transfer_date,
            MAX(e.event_date)                      AS last_event_date
          FROM livestock_events e
          GROUP BY e.batch_id
        ),
        recent AS (
          SELECT
            e.batch_id,
            COALESCE(SUM(e.transfer_in), 0)::INT AS recent_stock_in
          FROM livestock_events e
          JOIN agg a ON a.batch_id = e.batch_id
          WHERE e.transfer_in > 0
            AND e.event_date >= (a.last_transfer_date - INTERVAL '2 months')
          GROUP BY e.batch_id
        )
        SELECT
          b.batch_id, b.badge_name, b.farm_id, b.manager,
          b.stock_in_date, b.stock_in_count, b.prev_month_count,
          b.status, b.note, b.created_at,
          f."농장명" AS farm_name, f."지역" AS region,
          COALESCE(a.total_transfer_in, 0)::INT  AS total_transfer_in,
          COALESCE(a.total_deaths,      0)::INT  AS total_deaths,
          COALESCE(a.total_culled,      0)::INT  AS total_culled,
          COALESCE(a.total_shipped,     0)::INT  AS total_shipped,
          COALESCE(r.recent_stock_in,   0)::INT  AS recent_stock_in,
          (b.stock_in_count + COALESCE(a.total_transfer_in, 0))::INT AS cumulative_stock_in,
          COALESCE(a.total_stock_weight, 0)       AS total_stock_weight,
          CASE WHEN COALESCE(a.total_transfer_in, 0) > 0
            THEN ROUND(COALESCE(a.total_stock_weight, 0)::NUMERIC / a.total_transfer_in, 1)
            ELSE NULL
          END                                     AS avg_stock_weight,
          (b.prev_month_count
            + COALESCE(a.total_transfer_in, 0)
            - COALESCE(a.total_deaths,      0)
            - COALESCE(a.total_culled,      0)
            - COALESCE(a.total_shipped,     0)
            - COALESCE(a.total_deducted,    0)
          )::INT AS current_count,
          a.last_transfer_date,
          a.last_event_date
        FROM livestock_batches b
        LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
        LEFT JOIN agg a ON a.batch_id = b.batch_id
        LEFT JOIN recent r ON r.batch_id = b.batch_id
        ${whereClause}
        ORDER BY b.status, b.stock_in_date DESC
      `;
      const result = await runPgQuery(sql);
      res.json({ success: true, batches: result.rows });
    } catch (err) {
      console.error("Get batches error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 뱃지 등록
  // POST /api/livestock/batches
  router.post("/batches", async (req, res) => {
    try {
      const { badge_name, farm_id, manager, stock_in_date, stock_in_count, prev_month_count, note } = req.body;
      if (!badge_name) return res.status(400).json({ error: "badge_name is required" });

      const result = await runPgQuery(
        `INSERT INTO livestock_batches
           (badge_name, farm_id, manager, stock_in_date, stock_in_count, prev_month_count, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING batch_id`,
        [
          badge_name,
          farm_id || null,
          manager || null,
          stock_in_date || null,
          Number(stock_in_count) || 0,
          Number(prev_month_count) || 0,
          note || null,
        ]
      );
      auditLog(req, "INSERT", "livestock_batch", result.rows[0].batch_id, `배치 등록: ${badge_name}`);
      res.json({ success: true, batch_id: result.rows[0].batch_id });
    } catch (err) {
      console.error("Create batch error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 뱃지 수정
  // PUT /api/livestock/batches/:id
  router.put("/batches/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const { badge_name, farm_id, manager, stock_in_date, stock_in_count, prev_month_count, status, note } = req.body;

      await runPgQuery(
        `UPDATE livestock_batches
         SET badge_name=$1, farm_id=$2, manager=$3, stock_in_date=$4,
             stock_in_count=$5, prev_month_count=$6, status=$7, note=$8
         WHERE batch_id=$9`,
        [
          badge_name,
          farm_id || null,
          manager || null,
          stock_in_date || null,
          Number(stock_in_count) || 0,
          Number(prev_month_count) || 0,
          status || "active",
          note || null,
          id,
        ]
      );
      auditLog(req, "UPDATE", "livestock_batch", id, `배치 수정: ${badge_name}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Update batch error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 뱃지 상태 변경 (active ↔ completed)
  // PATCH /api/livestock/batches/:id/status
  router.patch("/batches/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { status } = req.body;
      if (!["active", "completed"].includes(status)) return res.status(400).json({ error: "Invalid status" });

      await runPgQuery(`UPDATE livestock_batches SET status=$1 WHERE batch_id=$2`, [status, id]);
      auditLog(req, "UPDATE", "livestock_batch", id, `배치 상태 변경: id=${id} → ${status}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Patch batch status error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────
  // 파스 목록 (현황)
  // GET /api/livestock/passes?view=latest|all
  // ─────────────────────────────────────────
  router.get("/passes", async (req, res) => {
    const view = req.query.view || "latest";
    try {
      const passFilter = view === "all" ? "" : "AND p.status = 'active'";
      const sql = `
        WITH pass_agg AS (
          SELECT
            e.pass_id,
            COALESCE(SUM(e.transfer_in), 0)::INT AS total_transfer_in,
            COALESCE(SUM(e.deaths),      0)::INT AS total_deaths,
            COALESCE(SUM(e.culled),      0)::INT AS total_culled,
            COALESCE(SUM(e.shipped),     0)::INT AS total_shipped,
            COALESCE(SUM(e.deducted),    0)::INT AS total_deducted,
            MAX(e.event_date) AS last_event_date
          FROM livestock_events e
          WHERE e.pass_id IS NOT NULL
          GROUP BY e.pass_id
        ),
        batches_with_pass AS (
          SELECT DISTINCT batch_id FROM livestock_passes
        ),
        batch_agg AS (
          SELECT
            e.batch_id,
            COALESCE(SUM(e.transfer_in), 0)::INT AS total_transfer_in,
            COALESCE(SUM(e.deaths),      0)::INT AS total_deaths,
            COALESCE(SUM(e.culled),      0)::INT AS total_culled,
            COALESCE(SUM(e.shipped),     0)::INT AS total_shipped,
            COALESCE(SUM(e.deducted),    0)::INT AS total_deducted,
            MAX(e.event_date) AS last_event_date
          FROM livestock_events e
          WHERE e.pass_id IS NULL
          GROUP BY e.batch_id
        )
        SELECT
          p.pass_id, p.pass_name, p.pass_no, p.year_yy,
          p.status    AS pass_status,
          p.start_count, p.started_at, p.ended_at,
          b.batch_id, b.badge_name, b.manager,
          f."농장명" AS farm_name,
          COALESCE(a.total_transfer_in, 0) AS total_transfer_in,
          COALESCE(a.total_deaths,      0) AS total_deaths,
          COALESCE(a.total_culled,      0) AS total_culled,
          COALESCE(a.total_shipped,     0) AS total_shipped,
          COALESCE(a.total_deducted,    0) AS total_deducted,
          a.last_event_date,
          (p.start_count
           + COALESCE(a.total_transfer_in, 0)
           - COALESCE(a.total_deaths,      0)
           - COALESCE(a.total_culled,      0)
           - COALESCE(a.total_shipped,     0)
           - COALESCE(a.total_deducted,    0)
          )::INT AS current_count
        FROM livestock_passes p
        JOIN livestock_batches b ON b.batch_id = p.batch_id
        LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
        LEFT JOIN pass_agg a ON a.pass_id = p.pass_id
        WHERE b.status = 'active' ${passFilter}

        UNION ALL

        -- 파스가 없는 배치 (기존 방식)
        SELECT
          NULL AS pass_id, NULL AS pass_name, NULL AS pass_no, NULL AS year_yy,
          'batch' AS pass_status,
          (b.prev_month_count + b.stock_in_count)::INT AS start_count,
          b.stock_in_date AS started_at, NULL AS ended_at,
          b.batch_id, b.badge_name, b.manager,
          f."농장명" AS farm_name,
          COALESCE(a.total_transfer_in, 0) AS total_transfer_in,
          COALESCE(a.total_deaths,      0) AS total_deaths,
          COALESCE(a.total_culled,      0) AS total_culled,
          COALESCE(a.total_shipped,     0) AS total_shipped,
          COALESCE(a.total_deducted,    0) AS total_deducted,
          a.last_event_date,
          (b.prev_month_count + b.stock_in_count
           + COALESCE(a.total_transfer_in, 0)
           - COALESCE(a.total_deaths,      0)
           - COALESCE(a.total_culled,      0)
           - COALESCE(a.total_shipped,     0)
           - COALESCE(a.total_deducted,    0)
          )::INT AS current_count
        FROM livestock_batches b
        LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
        LEFT JOIN batch_agg a ON a.batch_id = b.batch_id
        WHERE b.status = 'active'
          AND b.batch_id NOT IN (SELECT batch_id FROM batches_with_pass)

        ORDER BY badge_name, year_yy NULLS LAST, pass_no NULLS LAST
      `;
      const result = await runPgQuery(sql);
      res.json({ success: true, passes: result.rows });
    } catch (err) {
      console.error("Get passes error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 배치별 파스 목록 (이벤트 입력 드롭다운용)
  // GET /api/livestock/passes/for-batch/:batch_id
  router.get("/passes/for-batch/:batch_id", async (req, res) => {
    const batch_id = parseInt(req.params.batch_id, 10);
    if (isNaN(batch_id)) return res.status(400).json({ error: "Invalid batch_id" });
    try {
      const result = await runPgQuery(
        `SELECT pass_id, pass_name, pass_no, status
         FROM livestock_passes
         WHERE batch_id = $1
         ORDER BY year_yy, pass_no`,
        [batch_id]
      );
      res.json({ success: true, passes: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 첫 파스 생성
  // POST /api/livestock/passes
  router.post("/passes", async (req, res) => {
    const { batch_id, note } = req.body;
    if (!batch_id) return res.status(400).json({ error: "batch_id is required" });
    try {
      const batchRes = await runPgQuery(
        `SELECT batch_id, badge_name, stock_in_count, prev_month_count FROM livestock_batches WHERE batch_id = $1`,
        [Number(batch_id)]
      );
      const batch = batchRes.rows[0];
      if (!batch) return res.status(404).json({ success: false, error: "배치를 찾을 수 없습니다." });

      const existRes = await runPgQuery(
        `SELECT COUNT(*) AS cnt FROM livestock_passes WHERE batch_id = $1`,
        [Number(batch_id)]
      );
      if (parseInt(existRes.rows[0].cnt) > 0) {
        return res.status(400).json({ success: false, error: "이미 파스가 있습니다. 다음 파스로 전환해 주세요." });
      }

      const yearYY = new Date().getFullYear() % 100;
      const passNo = 1;
      const passName = `${batch.badge_name}-${String(yearYY).padStart(2, "0")}-${passNo}`;
      const startCount = (batch.prev_month_count || 0) + (batch.stock_in_count || 0);

      const passRes = await runPgQuery(
        `INSERT INTO livestock_passes (batch_id, pass_name, pass_no, year_yy, start_count, status, started_at, note)
         VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_DATE, $6)
         RETURNING pass_id, pass_name`,
        [Number(batch_id), passName, passNo, yearYY, startCount, note || null]
      );
      const newPass = passRes.rows[0];

      // 기존 이벤트를 이 파스에 연결
      await runPgQuery(
        `UPDATE livestock_events SET pass_id = $1 WHERE batch_id = $2 AND pass_id IS NULL`,
        [newPass.pass_id, Number(batch_id)]
      );

      auditLog(req, "INSERT", "livestock_pass", newPass.pass_id, `파스 생성: ${passName}`);
      res.json({ success: true, pass: newPass });
    } catch (err) {
      console.error("Create pass error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 다음 파스로 전환
  // POST /api/livestock/passes/:id/next
  router.post("/passes/:id/next", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const passRes = await runPgQuery(
        `SELECT p.*, b.badge_name FROM livestock_passes p
         JOIN livestock_batches b ON b.batch_id = p.batch_id
         WHERE p.pass_id = $1`,
        [id]
      );
      const pass = passRes.rows[0];
      if (!pass) return res.status(404).json({ success: false, error: "파스를 찾을 수 없습니다." });
      if (pass.status !== "active") return res.status(400).json({ success: false, error: "활성 파스가 아닙니다." });

      // 현재 파스 잔여두수 계산
      const aggRes = await runPgQuery(
        `SELECT
           COALESCE(SUM(transfer_in), 0)::INT AS total_transfer_in,
           COALESCE(SUM(deaths),      0)::INT AS total_deaths,
           COALESCE(SUM(culled),      0)::INT AS total_culled,
           COALESCE(SUM(shipped),     0)::INT AS total_shipped,
           COALESCE(SUM(deducted),    0)::INT AS total_deducted
         FROM livestock_events WHERE pass_id = $1`,
        [id]
      );
      const agg = aggRes.rows[0];
      const currentCount = pass.start_count
        + agg.total_transfer_in - agg.total_deaths
        - agg.total_culled - agg.total_shipped - agg.total_deducted;

      // 현재 파스 완료
      await runPgQuery(
        `UPDATE livestock_passes SET status = 'completed', ended_at = CURRENT_DATE WHERE pass_id = $1`,
        [id]
      );

      // 새 파스 생성
      const yearYY = new Date().getFullYear() % 100;
      const newPassNo = pass.pass_no + 1;
      const newPassName = `${pass.badge_name}-${String(yearYY).padStart(2, "0")}-${newPassNo}`;

      const newPassRes = await runPgQuery(
        `INSERT INTO livestock_passes (batch_id, pass_name, pass_no, year_yy, start_count, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_DATE)
         RETURNING pass_id, pass_name, start_count`,
        [pass.batch_id, newPassName, newPassNo, yearYY, currentCount]
      );
      const newPass = newPassRes.rows[0];

      auditLog(req, "INSERT", "livestock_pass", newPass.pass_id,
        `파스 전환: ${pass.pass_name} → ${newPassName} (이월두수: ${currentCount})`);
      res.json({ success: true, new_pass: newPass, prev_count: currentCount });
    } catch (err) {
      console.error("Next pass error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────
  // 이벤트 목록
  // GET /api/livestock/events?batch_id=&date_from=&date_to=
  // ─────────────────────────────────────────
  router.get("/events", async (req, res) => {
    try {
      const { batch_id, date_from, date_to } = req.query;
      const conditions = [];
      const params = [];

      if (batch_id) { conditions.push(`e.batch_id = $${params.length + 1}`); params.push(Number(batch_id)); }
      if (date_from) { conditions.push(`e.event_date >= $${params.length + 1}`); params.push(date_from); }
      if (date_to)   { conditions.push(`e.event_date <= $${params.length + 1}`); params.push(date_to); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await runPgQuery(
        `SELECT e.*, b.badge_name, p.pass_name
         FROM livestock_events e
         JOIN livestock_batches b ON b.batch_id = e.batch_id
         LEFT JOIN livestock_passes p ON p.pass_id = e.pass_id
         ${where}
         ORDER BY e.event_date DESC, e.batch_id`,
        params
      );
      res.json({ success: true, events: result.rows });
    } catch (err) {
      console.error("Get events error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 이벤트 등록 (로그 방식 — 매 제출마다 새 행 추가, 통계는 SUM으로 집계)
  // POST /api/livestock/events
  router.post("/events", async (req, res) => {
    try {
      const {
        batch_id, pass_id, event_date, event_type,
        transfer_in, deaths, culled, shipped, deducted,
        stock_weight, ship_weight, death_type,
        distributor, slaughterhouse, meat_processor, note,
      } = req.body;
      if (!batch_id || !event_date) return res.status(400).json({ error: "batch_id and event_date are required" });

      const ti  = Number(transfer_in) || 0;
      const d   = Number(deaths)      || 0;
      const c   = Number(culled)      || 0;
      const s   = Number(shipped)     || 0;
      const ded = Number(deducted)    || 0;
      const sw  = stock_weight != null && stock_weight !== "" ? Number(stock_weight) : null;
      const shw = ship_weight  != null && ship_weight  !== "" ? Number(ship_weight)  : null;
      const pid = pass_id ? Number(pass_id) : null;

      if (ti === 0 && d === 0 && c === 0 && s === 0 && ded === 0) {
        return res.status(400).json({ error: "하나 이상의 두수를 입력하세요." });
      }

      const result = await runPgQuery(
        `INSERT INTO livestock_events
           (batch_id, pass_id, event_date, event_type, transfer_in, deaths, culled, shipped, deducted,
            stock_weight, ship_weight, death_type, distributor, slaughterhouse, meat_processor, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING event_id`,
        [
          Number(batch_id), pid, event_date, event_type || null,
          ti, d, c, s, ded,
          sw, shw, death_type || null,
          distributor || null, slaughterhouse || null, meat_processor || null,
          note || null,
        ]
      );
      auditLog(req, "INSERT", "livestock_event", result.rows[0].event_id,
        `이벤트 등록: batch_id=${batch_id}, 유형=${event_type}, 날짜=${event_date}`);
      res.json({ success: true, event_id: result.rows[0].event_id });
    } catch (err) {
      console.error("Create event error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 이벤트 수정
  // PUT /api/livestock/events/:id
  router.put("/events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const {
        event_date, event_type, transfer_in, deaths, culled, shipped, deducted,
        stock_weight, ship_weight, death_type,
        distributor, slaughterhouse, meat_processor, note,
      } = req.body;
      const sw  = stock_weight != null && stock_weight !== "" ? Number(stock_weight) : null;
      const shw = ship_weight  != null && ship_weight  !== "" ? Number(ship_weight)  : null;
      await runPgQuery(
        `UPDATE livestock_events
         SET event_date=$1, event_type=$2, transfer_in=$3, deaths=$4, culled=$5, shipped=$6, deducted=$7,
             stock_weight=$8, ship_weight=$9, death_type=$10,
             distributor=$11, slaughterhouse=$12, meat_processor=$13, note=$14
         WHERE event_id=$15`,
        [
          event_date, event_type || null,
          Number(transfer_in) || 0, Number(deaths) || 0, Number(culled) || 0, Number(shipped) || 0, Number(deducted) || 0,
          sw, shw, death_type || null,
          distributor || null, slaughterhouse || null, meat_processor || null,
          note || null, id,
        ]
      );
      auditLog(req, "UPDATE", "livestock_event", id, `이벤트 수정: id=${id}, 날짜=${event_date}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Update event error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 이벤트 삭제
  // DELETE /api/livestock/events/:id
  router.delete("/events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await runPgQuery(`DELETE FROM livestock_events WHERE event_id=$1`, [id]);
      auditLog(req, "DELETE", "livestock_event", id, `이벤트 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete event error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────
  // 폐사율 리포트
  // GET /api/livestock/report/mortality
  // ─────────────────────────────────────────
  router.get("/report/mortality", async (req, res) => {
    try {
      const metaRes = await runPgQuery(`SELECT value FROM app_settings WHERE key = 'mortality_benchmark_monthly_pct'`);
      const benchmarkRate = parseFloat(metaRes.rows[0]?.value ?? "0.5");

      const result = await runPgQuery(`
        SELECT
          b.batch_id,
          b.badge_name,
          b.manager,
          COALESCE(MAX(CASE WHEN e.transfer_in > 0 THEN e.event_date END), b.stock_in_date) AS stock_in_date,
          (b.stock_in_count + COALESCE(SUM(e.transfer_in), 0))::INT                  AS stock_in_count,
          b.status,
          COALESCE(SUM(e.deaths), 0)::INT                                             AS total_deaths,
          COALESCE(SUM(e.culled), 0)::INT                                             AS total_culled,
          ROUND(
            COALESCE(SUM(e.deaths), 0)::NUMERIC
            / NULLIF(b.stock_in_count + COALESCE(SUM(e.transfer_in), 0), 0) * 100, 2
          )                                                                            AS mortality_pct,
          (CURRENT_DATE - COALESCE(MAX(CASE WHEN e.transfer_in > 0 THEN e.event_date END), b.stock_in_date) + 1)
                                                                                      AS days_elapsed,
          ROUND(
            (CURRENT_DATE - COALESCE(MAX(CASE WHEN e.transfer_in > 0 THEN e.event_date END), b.stock_in_date) + 1)::NUMERIC / 30.0, 1
          )                                                                            AS months_elapsed
        FROM livestock_batches b
        LEFT JOIN livestock_events e ON e.batch_id = b.batch_id
        WHERE b.status = 'active'
        GROUP BY b.batch_id
        ORDER BY mortality_pct DESC NULLS LAST
      `);

      const report = result.rows.map((r) => {
        const months = parseFloat(r.months_elapsed) || 0;
        const benchmarkPct = Math.round(months * benchmarkRate * 100) / 100;
        const mortalityPct = parseFloat(r.mortality_pct) || 0;
        return {
          ...r,
          benchmark_pct: benchmarkPct,
          diff_pct: Math.round((mortalityPct - benchmarkPct) * 100) / 100,
        };
      });

      res.json({ success: true, report });
    } catch (err) {
      console.error("Mortality report error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
