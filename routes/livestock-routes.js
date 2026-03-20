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
        SELECT
          b.batch_id, b.badge_name, b.farm_id, b.manager,
          b.stock_in_date, b.stock_in_count, b.prev_month_count,
          b.status, b.note, b.created_at,
          f."농장명" AS farm_name, f."지역" AS region,
          COALESCE(SUM(e.transfer_in), 0)::INT  AS total_transfer_in,
          COALESCE(SUM(e.deaths),      0)::INT  AS total_deaths,
          COALESCE(SUM(e.culled),      0)::INT  AS total_culled,
          COALESCE(SUM(e.shipped),     0)::INT  AS total_shipped,
          (b.prev_month_count
            + COALESCE(SUM(e.transfer_in), 0)
            - COALESCE(SUM(e.deaths),      0)
            - COALESCE(SUM(e.culled),      0)
            - COALESCE(SUM(e.shipped),     0)
          )::INT AS current_count
        FROM livestock_batches b
        LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
        LEFT JOIN livestock_events e ON e.batch_id = b.batch_id
        ${whereClause}
        GROUP BY b.batch_id, f."농장명", f."지역"
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
        `SELECT e.*, b.badge_name
         FROM livestock_events e
         JOIN livestock_batches b ON b.batch_id = e.batch_id
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
      const { batch_id, event_date, transfer_in, deaths, culled, shipped, note } = req.body;
      if (!batch_id || !event_date) return res.status(400).json({ error: "batch_id and event_date are required" });

      const ti = Number(transfer_in) || 0;
      const d  = Number(deaths)      || 0;
      const c  = Number(culled)      || 0;
      const s  = Number(shipped)     || 0;
      if (ti === 0 && d === 0 && c === 0 && s === 0) {
        return res.status(400).json({ error: "하나 이상의 두수를 입력하세요." });
      }

      const result = await runPgQuery(
        `INSERT INTO livestock_events (batch_id, event_date, transfer_in, deaths, culled, shipped, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING event_id`,
        [Number(batch_id), event_date, ti, d, c, s, note || null]
      );
      auditLog(req, "INSERT", "livestock_event", result.rows[0].event_id,
        `이벤트 등록: batch_id=${batch_id}, 날짜=${event_date}, 전입=${ti}, 폐사=${d}, 도태=${c}, 출하=${s}`);
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

      const { event_date, transfer_in, deaths, culled, shipped, note } = req.body;
      await runPgQuery(
        `UPDATE livestock_events
         SET event_date=$1, transfer_in=$2, deaths=$3, culled=$4, shipped=$5, note=$6
         WHERE event_id=$7`,
        [event_date, Number(transfer_in) || 0, Number(deaths) || 0, Number(culled) || 0, Number(shipped) || 0, note || null, id]
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
      const result = await runPgQuery(`
        SELECT
          b.batch_id,
          b.badge_name,
          b.manager,
          b.stock_in_date,
          b.stock_in_count,
          b.status,
          COALESCE(SUM(e.deaths), 0)::INT                                             AS total_deaths,
          COALESCE(SUM(e.culled), 0)::INT                                             AS total_culled,
          ROUND(
            COALESCE(SUM(e.deaths), 0)::NUMERIC / NULLIF(b.stock_in_count, 0) * 100, 2
          )                                                                            AS mortality_pct,
          ROUND(
            EXTRACT(EPOCH FROM (NOW() - b.stock_in_date::TIMESTAMPTZ)) / (30.0 * 86400), 1
          )                                                                            AS months_elapsed,
          ROUND(
            EXTRACT(EPOCH FROM (NOW() - b.stock_in_date::TIMESTAMPTZ)) / (30.0 * 86400) * 0.5, 2
          )                                                                            AS benchmark_pct
        FROM livestock_batches b
        LEFT JOIN livestock_events e ON e.batch_id = b.batch_id
        WHERE b.status = 'active'
        GROUP BY b.batch_id
        ORDER BY mortality_pct DESC NULLS LAST
      `);
      res.json({ success: true, report: result.rows });
    } catch (err) {
      console.error("Mortality report error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
