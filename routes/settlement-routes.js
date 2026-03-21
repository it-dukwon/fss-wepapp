// routes/settlement-routes.js
const express = require("express");
const path    = require("path");
const ExcelJS = require("exceljs");
const { auditLog } = require("../utils/audit-log");

module.exports = function settlementRoutes({ runPgQuery }) {
  const router = express.Router();

  // ─── 테이블 자동 생성 ────────────────────────────────────────
  runPgQuery(`
    CREATE TABLE IF NOT EXISTS consignment_settlements (
      id                   SERIAL PRIMARY KEY,
      batch_id             INT UNIQUE REFERENCES livestock_batches(batch_id),
      farm_account         VARCHAR(200),
      initial_stock_weight NUMERIC(10,2),
      claim_count          INT            DEFAULT 0,
      std_mortality_rate   NUMERIC(6,4)   DEFAULT 0.03,
      grade_1plus          INT            DEFAULT 0,
      grade_1              INT            DEFAULT 0,
      grade_2              INT            DEFAULT 0,
      grade_out_spec       INT            DEFAULT 0,
      grade_out_other      INT            DEFAULT 0,
      grade_penalty        NUMERIC(15,0)  DEFAULT 0,
      feed_piglet          NUMERIC(10,2)  DEFAULT 0,
      feed_grow            NUMERIC(10,2)  DEFAULT 0,
      feed_cost_total      NUMERIC(15,0)  DEFAULT 0,
      base_fee             NUMERIC(15,0)  DEFAULT 0,
      incentive_growth     NUMERIC(15,0)  DEFAULT 0,
      incentive_feed       NUMERIC(15,0)  DEFAULT 0,
      penalty_grade        NUMERIC(15,0)  DEFAULT 0,
      prepayment           NUMERIC(15,0)  DEFAULT 0,
      payment_note         VARCHAR(500),
      revenue              NUMERIC(15,0)  DEFAULT 0,
      piglet_cost          NUMERIC(15,0)  DEFAULT 0,
      created_at           TIMESTAMPTZ    DEFAULT NOW(),
      updated_at           TIMESTAMPTZ    DEFAULT NOW()
    )
  `).catch((e) => console.error("Settlement table init error:", e.message));

  // ─── 공통 계산 헬퍼 ──────────────────────────────────────────
  async function getSettlementData(batch_id) {
    const batchRes = await runPgQuery(
      `SELECT b.*, f."농장명" AS farm_name, f."지역" AS region
       FROM livestock_batches b
       LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
       WHERE b.batch_id = $1`,
      [batch_id]
    );
    if (!batchRes.rows.length) return null;
    const batch = batchRes.rows[0];

    const aggRes = await runPgQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type='stock_in' THEN stock_weight  ELSE 0 END), 0) AS event_stock_weight,
         COALESCE(SUM(CASE WHEN event_type='shipping' THEN shipped       ELSE 0 END), 0)::INT AS total_shipped,
         COALESCE(SUM(CASE WHEN event_type='shipping' THEN ship_weight   ELSE 0 END), 0) AS total_ship_weight,
         COALESCE(SUM(deaths), 0)::INT AS total_deaths,
         COALESCE(SUM(culled), 0)::INT AS total_culled,
         MAX(CASE WHEN event_type='shipping' THEN event_date END)        AS last_ship_date
       FROM livestock_events WHERE batch_id = $1`,
      [batch_id]
    );
    const agg = aggRes.rows[0];

    const settRes = await runPgQuery(
      `SELECT * FROM consignment_settlements WHERE batch_id = $1`,
      [batch_id]
    );
    const manual = settRes.rows[0] || {};

    const evRes = await runPgQuery(
      `SELECT event_date, event_type, transfer_in, stock_weight,
              deaths, culled, death_type,
              shipped, ship_weight, distributor, slaughterhouse, meat_processor, note
       FROM livestock_events
       WHERE batch_id = $1
       ORDER BY event_date, event_id`,
      [batch_id]
    );
    const events = evRes.rows;

    // ── 기본 계산 ────────────────────────────────────────────
    const stock_in_date          = batch.stock_in_date;
    const stock_in_count         = batch.stock_in_count || 0;
    const initial_stock_weight   = Number(manual.initial_stock_weight  ?? agg.event_stock_weight ?? 0);
    const avg_stock_weight       = stock_in_count > 0 ? initial_stock_weight / stock_in_count : 0;

    const total_shipped          = Number(agg.total_shipped);
    const total_ship_weight      = Number(agg.total_ship_weight);
    const avg_ship_weight        = total_shipped > 0 ? total_ship_weight / total_shipped : 0;
    const last_ship_date         = agg.last_ship_date;

    const breeding_days = (stock_in_date && last_ship_date)
      ? Math.round((new Date(last_ship_date) - new Date(stock_in_date)) / 86400000)
      : 0;
    const total_weight_gain = total_ship_weight - initial_stock_weight;
    const daily_gain_g     = breeding_days > 0 ? (total_weight_gain / breeding_days) * 1000 : 0;
    const daily_gain_per   = (breeding_days > 0 && stock_in_count > 0)
      ? total_weight_gain / breeding_days / stock_in_count : 0;

    // ── 도폐사 ──────────────────────────────────────────────
    const total_deaths   = Number(agg.total_deaths);
    const total_culled   = Number(agg.total_culled);
    const total_dead     = total_deaths + total_culled;
    const claim_count    = Number(manual.claim_count ?? 0);
    const adj_dead       = total_dead - claim_count;
    const mortality_act  = stock_in_count > 0 ? adj_dead / stock_in_count : 0;
    const std_rate       = Number(manual.std_mortality_rate ?? 0.03);
    const std_head       = Math.floor(stock_in_count * std_rate);
    const deduct_head    = Math.max(0, adj_dead - std_head);
    const settlement_count = total_shipped;

    // ── 사료 ────────────────────────────────────────────────
    const feed_piglet    = Number(manual.feed_piglet    ?? 0);
    const feed_grow      = Number(manual.feed_grow      ?? 0);
    const feed_total     = feed_piglet + feed_grow;
    const feed_cost      = Number(manual.feed_cost_total ?? 0);
    const feed_fcr       = total_weight_gain > 0 ? feed_total / total_weight_gain : 0;
    const feed_daily     = (breeding_days > 0 && stock_in_count > 0) ? feed_total / breeding_days / stock_in_count : 0;
    const feed_per_head  = stock_in_count > 0 ? feed_total / stock_in_count : 0;
    const feed_avg_cost  = stock_in_count > 0 ? feed_cost / stock_in_count : 0;
    const feed_cost_per_kg = feed_total > 0 ? feed_cost / feed_total : 0;

    // ── 위탁사육비 ───────────────────────────────────────────
    const base_fee          = Number(manual.base_fee          ?? 0);
    const incentive_growth  = Number(manual.incentive_growth  ?? 0);
    const incentive_feed    = Number(manual.incentive_feed    ?? 0);
    const penalty_grade     = Number(manual.penalty_grade     ?? 0);
    const grade_penalty     = Number(manual.grade_penalty     ?? 0);
    const prepayment        = Number(manual.prepayment        ?? 0);
    const net_payment       = base_fee + incentive_growth + incentive_feed
                            - penalty_grade - grade_penalty - prepayment;

    // ── 수익 분석 ─────────────────────────────────────────────
    const revenue    = Number(manual.revenue     ?? 0);
    const piglet_cost = Number(manual.piglet_cost ?? 0);
    const farm_net   = revenue - piglet_cost - feed_cost - net_payment;

    // ── 현재 잔여두수 ─────────────────────────────────────────
    const current_count = stock_in_count + Number(agg.event_stock_weight > 0 ? 0 : 0)
      - total_dead - total_shipped;
    // simpler:
    const remaining = batch.prev_month_count
      + events.reduce((s, e) => s + (e.transfer_in || 0), 0)
      - total_dead - total_shipped;

    return {
      batch, manual, events,
      stock_in_count, stock_in_date, initial_stock_weight, avg_stock_weight,
      total_shipped, total_ship_weight, avg_ship_weight, last_ship_date,
      breeding_days, total_weight_gain, daily_gain_g, daily_gain_per,
      total_deaths, total_culled, total_dead,
      claim_count, adj_dead, mortality_act, std_rate, std_head, deduct_head, settlement_count,
      feed_piglet, feed_grow, feed_total, feed_cost,
      feed_fcr, feed_daily, feed_per_head, feed_avg_cost, feed_cost_per_kg,
      base_fee, incentive_growth, incentive_feed, penalty_grade, grade_penalty, prepayment,
      net_payment, revenue, piglet_cost, farm_net, remaining,
    };
  }

  // ─── GET /api/settlement (뱃지 목록) ────────────────────────
  router.get("/", async (req, res) => {
    try {
      const r = await runPgQuery(
        `SELECT b.batch_id, b.badge_name, b.stock_in_date, b.status,
                f."농장명" AS farm_name
         FROM livestock_batches b
         LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
         ORDER BY b.status, b.stock_in_date DESC`
      );
      res.json({ success: true, batches: r.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── GET /api/settlement/:batch_id ──────────────────────────
  router.get("/:batch_id", async (req, res) => {
    try {
      const batch_id = parseInt(req.params.batch_id, 10);
      const data = await getSettlementData(batch_id);
      if (!data) return res.status(404).json({ error: "뱃지를 찾을 수 없습니다." });
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── PUT /api/settlement/:batch_id ──────────────────────────
  router.put("/:batch_id", async (req, res) => {
    try {
      const batch_id = parseInt(req.params.batch_id, 10);
      const b = req.body;
      const n = (v) => (v !== undefined && v !== "" && v !== null ? Number(v) : null);
      const s = (v) => v || null;

      await runPgQuery(
        `INSERT INTO consignment_settlements
           (batch_id, farm_account, initial_stock_weight, claim_count, std_mortality_rate,
            grade_1plus, grade_1, grade_2, grade_out_spec, grade_out_other, grade_penalty,
            feed_piglet, feed_grow, feed_cost_total,
            base_fee, incentive_growth, incentive_feed, penalty_grade, prepayment, payment_note,
            revenue, piglet_cost, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
         ON CONFLICT (batch_id) DO UPDATE SET
           farm_account=$2, initial_stock_weight=$3, claim_count=$4, std_mortality_rate=$5,
           grade_1plus=$6, grade_1=$7, grade_2=$8, grade_out_spec=$9, grade_out_other=$10, grade_penalty=$11,
           feed_piglet=$12, feed_grow=$13, feed_cost_total=$14,
           base_fee=$15, incentive_growth=$16, incentive_feed=$17, penalty_grade=$18, prepayment=$19, payment_note=$20,
           revenue=$21, piglet_cost=$22, updated_at=NOW()`,
        [
          batch_id,
          s(b.farm_account), n(b.initial_stock_weight),
          n(b.claim_count) ?? 0, n(b.std_mortality_rate) ?? 0.03,
          n(b.grade_1plus) ?? 0, n(b.grade_1) ?? 0, n(b.grade_2) ?? 0,
          n(b.grade_out_spec) ?? 0, n(b.grade_out_other) ?? 0, n(b.grade_penalty) ?? 0,
          n(b.feed_piglet) ?? 0, n(b.feed_grow) ?? 0, n(b.feed_cost_total) ?? 0,
          n(b.base_fee) ?? 0, n(b.incentive_growth) ?? 0, n(b.incentive_feed) ?? 0,
          n(b.penalty_grade) ?? 0, n(b.prepayment) ?? 0, s(b.payment_note),
          n(b.revenue) ?? 0, n(b.piglet_cost) ?? 0,
        ]
      );
      auditLog(req, "UPDATE", "settlement", batch_id, `정산서 저장: batch_id=${batch_id}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── GET /api/settlement/:batch_id/excel ────────────────────
  router.get("/:batch_id/excel", async (req, res) => {
    try {
      const batch_id = parseInt(req.params.batch_id, 10);
      const d = await getSettlementData(batch_id);
      if (!d) return res.status(404).json({ error: "뱃지를 찾을 수 없습니다." });

      const {
        batch, manual, events,
        stock_in_count, stock_in_date, initial_stock_weight, avg_stock_weight,
        total_shipped, total_ship_weight, avg_ship_weight, last_ship_date,
        breeding_days, total_weight_gain, daily_gain_g, daily_gain_per,
        total_dead, claim_count, adj_dead, mortality_act,
        std_rate, std_head, deduct_head, settlement_count,
        feed_piglet, feed_grow, feed_total, feed_cost,
        feed_fcr, feed_daily, feed_per_head, feed_avg_cost,
        base_fee, incentive_growth, incentive_feed, penalty_grade, grade_penalty, prepayment,
        net_payment, revenue, piglet_cost, farm_net,
      } = d;

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path.join(__dirname, "../templates/settlement_template.xlsx"));
      const ws = wb.getWorksheet(1);

      const asDate = (v) => v ? new Date(v) : null;

      // ── 제목 ─────────────────────────────────────
      ws.getCell("B2").value = `위 탁 사 육 정 산 서 (${batch.badge_name})`;

      // ── 위탁장명 / 계좌 ──────────────────────────
      ws.getCell("I4").value = batch.farm_name || batch.manager || "";
      ws.getCell("I5").value = manual.farm_account || "";

      // ── 입식 ─────────────────────────────────────
      ws.getCell("D6").value = asDate(stock_in_date);
      ws.getCell("F6").value = stock_in_count;
      ws.getCell("I6").value = initial_stock_weight;
      ws.getCell("K6").value = avg_stock_weight;

      // ── 출하 ─────────────────────────────────────
      ws.getCell("D7").value = asDate(last_ship_date);
      ws.getCell("F7").value = total_shipped;
      ws.getCell("I7").value = total_ship_weight;
      ws.getCell("K7").value = avg_ship_weight;

      // ── 사육기간 / 증체 ───────────────────────────
      ws.getCell("D8").value = breeding_days;
      ws.getCell("F8").value = total_weight_gain;
      ws.getCell("I8").value = daily_gain_g;
      ws.getCell("K8").value = daily_gain_per;

      // ── 도폐사 실적 ───────────────────────────────
      ws.getCell("C10").value = stock_in_count;
      ws.getCell("E10").value = claim_count;
      ws.getCell("G10").value = total_dead;
      ws.getCell("I10").value = adj_dead;
      ws.getCell("K10").value = mortality_act;

      ws.getCell("C11").value = settlement_count;
      ws.getCell("E11").value = std_rate;
      ws.getCell("G11").value = std_head;
      ws.getCell("I11").value = mortality_act;
      ws.getCell("K11").value = deduct_head;

      // ── 출하 실적 등급 ────────────────────────────
      ws.getCell("C13").value = manual.grade_1plus   || 0;
      ws.getCell("E13").value = manual.grade_1        || 0;
      ws.getCell("G13").value = manual.grade_2        || 0;
      ws.getCell("I13").value = manual.grade_out_spec || 0;
      ws.getCell("K13").value = manual.grade_out_other || 0;
      ws.getCell("J14").value = grade_penalty;

      // ── 사료 ─────────────────────────────────────
      ws.getCell("C16").value = feed_piglet;
      ws.getCell("E16").value = feed_grow;
      ws.getCell("G16").value = feed_total;
      ws.getCell("I16").value = feed_fcr;
      ws.getCell("C17").value = feed_daily;
      ws.getCell("E17").value = feed_per_head;
      ws.getCell("G17").value = feed_cost;
      ws.getCell("I17").value = feed_avg_cost;

      // ── 위탁사육비 ────────────────────────────────
      ws.getCell("B20").value = base_fee;
      ws.getCell("D20").value = incentive_growth;
      ws.getCell("F20").value = incentive_feed;
      ws.getCell("G20").value = penalty_grade;
      ws.getCell("H20").value = prepayment;
      ws.getCell("J20").value = net_payment;
      ws.getCell("N20").value = manual.payment_note || "";

      // ── 농장 수익 분석 ────────────────────────────
      ws.getCell("B23").value = revenue;
      ws.getCell("D23").value = piglet_cost;
      ws.getCell("F23").value = feed_cost;
      ws.getCell("H23").value = net_payment;
      ws.getCell("J23").value = farm_net;

      // ── 이력 테이블 클리어 (27~46) ────────────────
      for (let r = 27; r <= 46; r++) {
        ["B","C","D","E","F","G","H","I","J","K"].forEach((col) => {
          ws.getCell(`${col}${r}`).value = null;
        });
      }

      // ── 이력 테이블 채우기 ────────────────────────
      let row = 27;
      let running = stock_in_count;

      // 입식 초기 행
      if (row <= 46) {
        ws.getCell(`B${row}`).value = asDate(stock_in_date);
        ws.getCell(`C${row}`).value = stock_in_count;
        ws.getCell(`D${row}`).value = initial_stock_weight || null;
        ws.getCell(`E${row}`).value = avg_stock_weight || null;
        ws.getCell(`J${row}`).value = running;
        row++;
      }

      for (const ev of events) {
        if (row > 46) break;
        if (ev.event_type === "death") {
          const cnt = (ev.deaths || 0) + (ev.culled || 0);
          running -= cnt;
          ws.getCell(`B${row}`).value = asDate(ev.event_date);
          ws.getCell(`F${row}`).value = cnt;
          ws.getCell(`J${row}`).value = running;
          row++;
        } else if (ev.event_type === "shipping") {
          running -= (ev.shipped || 0);
          ws.getCell(`B${row}`).value = asDate(ev.event_date);
          ws.getCell(`G${row}`).value = ev.shipped;
          ws.getCell(`H${row}`).value = ev.ship_weight;
          ws.getCell(`I${row}`).value = ev.ship_weight && ev.shipped
            ? ev.ship_weight / ev.shipped : null;
          ws.getCell(`J${row}`).value = running;
          const outlets = [ev.distributor, ev.slaughterhouse, ev.meat_processor]
            .filter(Boolean).join(",");
          ws.getCell(`K${row}`).value = outlets || null;
          row++;
        }
      }

      // ── 합계 행 (row 47) ──────────────────────────
      ws.getCell("B47").value = "합계";
      ws.getCell("C47").value = stock_in_count;
      ws.getCell("D47").value = initial_stock_weight || null;
      ws.getCell("E47").value = avg_stock_weight || null;
      ws.getCell("F47").value = total_dead;
      ws.getCell("G47").value = total_shipped;
      ws.getCell("H47").value = total_ship_weight;
      ws.getCell("I47").value = avg_ship_weight || null;
      ws.getCell("J47").value = running;

      const filename = `${batch.badge_name}_위탁정산서.xlsx`;
      res.setHeader("Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Settlement Excel error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
