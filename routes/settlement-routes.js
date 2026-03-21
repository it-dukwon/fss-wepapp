// routes/settlement-routes.js
const express = require("express");
const path    = require("path");
const ExcelJS = require("exceljs");
const dayjs   = require("dayjs");
const utc     = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
const { auditLog } = require("../utils/audit-log");
const { sendMail }  = require("../utils/mailer");

module.exports = function settlementRoutes({ runPgQuery }) {
  const router = express.Router();

  // ─── 공통 계산 헬퍼 ──────────────────────────────────────────
  async function getSettlementData(batch_id) {
    const batchRes = await runPgQuery(
      `SELECT b.*, f."농장명" AS farm_name, f."지역" AS region, f.owner_email,
              f.bank_name, f.account_number, f.account_holder
       FROM livestock_batches b
       LEFT JOIN list_farms f ON f."농장ID" = b.farm_id
       WHERE b.batch_id = $1`,
      [batch_id]
    );
    if (!batchRes.rows.length) return null;
    const batch = batchRes.rows[0];

    const aggRes = await runPgQuery(
      `SELECT
         COALESCE(SUM(transfer_in),  0)::INT AS total_transfer_in,
         COALESCE(SUM(stock_weight), 0)       AS total_stock_weight,
         COALESCE(SUM(CASE WHEN event_type='shipping' THEN shipped     ELSE 0 END), 0)::INT AS total_shipped,
         COALESCE(SUM(CASE WHEN event_type='shipping' THEN ship_weight ELSE 0 END), 0)      AS total_ship_weight,
         COALESCE(SUM(deaths),   0)::INT AS total_deaths,
         COALESCE(SUM(culled),   0)::INT AS total_culled,
         COALESCE(SUM(deducted), 0)::INT AS total_deducted,
         MAX(CASE WHEN event_type='shipping' THEN event_date END) AS last_ship_date,
         MAX(CASE WHEN transfer_in > 0        THEN event_date END) AS last_stock_in_date
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
              deaths, culled, death_type, deducted,
              shipped, ship_weight, distributor, slaughterhouse, meat_processor, note
       FROM livestock_events
       WHERE batch_id = $1
       ORDER BY event_date, event_id`,
      [batch_id]
    );
    const events = evRes.rows;

    // ── 기본 계산 ────────────────────────────────────────────
    const stock_in_date          = agg.last_stock_in_date || batch.stock_in_date;
    const stock_in_count         = (batch.stock_in_count || 0) + Number(agg.total_transfer_in || 0);
    const initial_stock_weight   = Number(agg.total_stock_weight || 0);
    const avg_stock_weight       = stock_in_count > 0 ? initial_stock_weight / stock_in_count : 0;

    const total_shipped          = Number(agg.total_shipped);
    const total_ship_weight      = Number(agg.total_ship_weight);
    const avg_ship_weight        = total_shipped > 0 ? total_ship_weight / total_shipped : 0;
    const last_ship_date         = agg.last_ship_date;

    const breeding_days = stock_in_date
      ? Math.floor((new Date() - new Date(stock_in_date)) / 86400000) + 1
      : 0;
    const total_weight_gain = total_ship_weight - initial_stock_weight;
    const daily_gain_g     = breeding_days > 0 ? (total_weight_gain / breeding_days) * 1000 : 0;
    const daily_gain_per   = (breeding_days > 0 && stock_in_count > 0)
      ? total_weight_gain / breeding_days / stock_in_count : 0;

    // ── 도폐사 ──────────────────────────────────────────────
    const total_deaths   = Number(agg.total_deaths);
    const total_culled   = Number(agg.total_culled);
    const total_deducted = Number(agg.total_deducted || 0);
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

    // ── 현재 잔여두수 (사육두수 현황과 동일 로직) ───────────────────
    const remaining = stock_in_count - total_dead - total_shipped - total_deducted;

    return {
      batch, manual, events,
      stock_in_count, stock_in_date, initial_stock_weight, avg_stock_weight,
      total_shipped, total_ship_weight, avg_ship_weight, last_ship_date,
      breeding_days, total_weight_gain, daily_gain_g, daily_gain_per,
      total_deaths, total_culled, total_deducted, total_dead,
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

  // ─── Excel 워크북 생성 (공유 헬퍼) ──────────────────────────
  async function buildExcelBuffer(d) {
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

      // 첫 번째 시트만 남기고 나머지 제거
      wb.worksheets.slice(1).forEach(s => wb.removeWorksheet(s.id));

      const ws = wb.worksheets[0];

      // L열(0-based index 11) 밖의 이미지 제거
      if (ws._media) {
        ws._media = ws._media.filter(img => {
          const col = img.range?.tl?.col;
          return col == null || col < 12;
        });
      }

      // M열 이후(13열~) 셀 값 제거
      ws.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.col >= 13) cell.value = null;
        });
      });

      const asDate = (v) => v ? new Date(v) : null;

      ws.getCell("B2").value = `위 탁 사 육 정 산 서 (${batch.badge_name})`;
      ws.getCell("I4").value = batch.farm_name || batch.manager || "";
      const acct = [batch.bank_name, batch.account_number, batch.account_holder ? `(${batch.account_holder})` : ""]
        .filter(Boolean).join(" ");
      ws.getCell("I5").value = acct || manual.farm_account || "";
      ws.getCell("D6").value = asDate(stock_in_date);
      ws.getCell("F6").value = stock_in_count;
      ws.getCell("I6").value = initial_stock_weight;
      ws.getCell("K6").value = avg_stock_weight;
      ws.getCell("D7").value = asDate(last_ship_date);
      ws.getCell("F7").value = total_shipped;
      ws.getCell("I7").value = total_ship_weight;
      ws.getCell("K7").value = avg_ship_weight;
      ws.getCell("D8").value = breeding_days;
      ws.getCell("F8").value = total_weight_gain;
      ws.getCell("I8").value = daily_gain_g;
      ws.getCell("K8").value = daily_gain_per;
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
      ws.getCell("C13").value = manual.grade_1plus    || 0;
      ws.getCell("E13").value = manual.grade_1         || 0;
      ws.getCell("G13").value = manual.grade_2         || 0;
      ws.getCell("I13").value = manual.grade_out_spec  || 0;
      ws.getCell("K13").value = manual.grade_out_other || 0;
      ws.getCell("J14").value = grade_penalty;
      ws.getCell("C16").value = feed_piglet;
      ws.getCell("E16").value = feed_grow;
      ws.getCell("G16").value = feed_total;
      ws.getCell("I16").value = feed_fcr;
      ws.getCell("C17").value = feed_daily;
      ws.getCell("E17").value = feed_per_head;
      ws.getCell("G17").value = feed_cost;
      ws.getCell("I17").value = feed_avg_cost;
      ws.getCell("B20").value = base_fee;
      ws.getCell("D20").value = incentive_growth;
      ws.getCell("F20").value = incentive_feed;
      ws.getCell("G20").value = penalty_grade;
      ws.getCell("H20").value = prepayment;
      ws.getCell("J20").value = net_payment;
      ws.getCell("B23").value = revenue;
      ws.getCell("D23").value = piglet_cost;
      ws.getCell("F23").value = feed_cost;
      ws.getCell("H23").value = net_payment;
      ws.getCell("J23").value = farm_net;

      for (let r = 27; r <= 46; r++) {
        ["B","C","D","E","F","G","H","I","J","K"].forEach((col) => {
          ws.getCell(`${col}${r}`).value = null;
        });
      }

      let row = 27;
      let running = stock_in_count;
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
        if (ev.event_type === "death" || (!ev.event_type && (ev.deaths > 0 || ev.culled > 0))) {
          const cnt = (ev.deaths || 0) + (ev.culled || 0);
          running -= cnt;
          ws.getCell(`B${row}`).value = asDate(ev.event_date);
          ws.getCell(`F${row}`).value = cnt;
          ws.getCell(`J${row}`).value = running;
          row++;
        } else if (ev.event_type === "shipping" || (!ev.event_type && ev.shipped > 0)) {
          running -= (ev.shipped || 0);
          ws.getCell(`B${row}`).value = asDate(ev.event_date);
          ws.getCell(`G${row}`).value = ev.shipped;
          ws.getCell(`H${row}`).value = ev.ship_weight;
          ws.getCell(`I${row}`).value = ev.ship_weight && ev.shipped ? ev.ship_weight / ev.shipped : null;
          ws.getCell(`J${row}`).value = running;
          const outlets = [ev.distributor, ev.slaughterhouse, ev.meat_processor].filter(Boolean).join(",");
          ws.getCell(`K${row}`).value = outlets || null;
          row++;
        }
      }
      ws.getCell("B47").value = "합계";
      ws.getCell("C47").value = stock_in_count;
      ws.getCell("D47").value = initial_stock_weight || null;
      ws.getCell("E47").value = avg_stock_weight || null;
      ws.getCell("F47").value = total_dead;
      ws.getCell("G47").value = total_shipped;
      ws.getCell("H47").value = total_ship_weight;
      ws.getCell("I47").value = avg_ship_weight || null;
      ws.getCell("J47").value = running;

      return wb.xlsx.writeBuffer();
  }

  // ─── GET /api/settlement/:batch_id/excel ────────────────────
  router.get("/:batch_id/excel", async (req, res) => {
    try {
      const batch_id = parseInt(req.params.batch_id, 10);
      const d = await getSettlementData(batch_id);
      if (!d) return res.status(404).json({ error: "뱃지를 찾을 수 없습니다." });
      const buffer = await buildExcelBuffer(d);
      const today = dayjs().tz("Asia/Seoul").format("YYYYMMDD");
      const filename = `${d.batch.badge_name}_위탁정산서_${today}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (err) {
      console.error("Settlement Excel error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /api/settlement/:batch_id/send-email ──────────────
  router.post("/:batch_id/send-email", async (req, res) => {
    try {
      const batch_id = parseInt(req.params.batch_id, 10);
      const { to, cc } = req.body || {};
      if (!to) return res.status(400).json({ error: "수신자 이메일(to) 필수" });

      const d = await getSettlementData(batch_id);
      if (!d) return res.status(404).json({ error: "뱃지를 찾을 수 없습니다." });

      const buffer = await buildExcelBuffer(d);
      const today = dayjs().tz("Asia/Seoul").format("YYYYMMDD");
      const filename = `${d.batch.badge_name}_위탁정산서_${today}.xlsx`;

      const {
        batch,
        stock_in_count, stock_in_date, avg_stock_weight,
        total_shipped, total_ship_weight, avg_ship_weight,
        breeding_days, total_weight_gain, daily_gain_g,
        total_dead, mortality_act,
        net_payment, farm_net,
      } = d;

      const fmt = (v, decimals = 0) =>
        v != null ? Number(v).toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "-";
      const fmtDate = (v) => v ? String(v).slice(0, 10).replace(/-/g, ".") : "-";

      const html = `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8" /></head>
<body style="font-family:'Malgun Gothic',Arial,sans-serif;background:#f5f7f6;padding:24px;margin:0;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 4px;color:#184B37;">위 탁 사 육 정 산 서</h2>
    <p style="margin:0 0 24px;color:#888;font-size:13px;">뱃지: <strong>${batch.badge_name}</strong> &nbsp;|&nbsp; 농장: <strong>${batch.farm_name || "-"}</strong></p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <thead>
        <tr style="background:#f0f4f0;">
          <th style="padding:8px 10px;border:1px solid #ddd;text-align:center;" colspan="2">입식 정보</th>
          <th style="padding:8px 10px;border:1px solid #ddd;text-align:center;" colspan="2">출하 정보</th>
          <th style="padding:8px 10px;border:1px solid #ddd;text-align:center;" colspan="2">사육 성적</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">입식일</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmtDate(stock_in_date)}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">출하두수</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(total_shipped)}두</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">사육일수</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(breeding_days)}일</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">입식두수</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(stock_in_count)}두</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">출하총체중</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(total_ship_weight, 1)}kg</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">총증체</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(total_weight_gain, 1)}kg</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">입식평균체중</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(avg_stock_weight, 1)}kg</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">평균출하체중</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(avg_ship_weight, 1)}kg</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">일당증체</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;">${fmt(daily_gain_g, 0)}g</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">폐사두수</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;color:#d9534f;">${fmt(total_dead)}두</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">폐사율</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:600;color:#d9534f;">${fmt(mortality_act, 2)}%</td>
          <td style="padding:8px 10px;border:1px solid #ddd;"></td>
          <td style="padding:8px 10px;border:1px solid #ddd;"></td>
        </tr>
      </tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <thead>
        <tr style="background:#f0f4f0;">
          <th style="padding:8px 10px;border:1px solid #ddd;text-align:center;" colspan="4">정산 내역</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">위탁사육비 (순지급액)</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:700;font-size:15px;color:#184B37;">${fmt(net_payment)}원</td>
          <td style="padding:8px 10px;border:1px solid #ddd;color:#555;">농장 순수익</td>
          <td style="padding:8px 10px;border:1px solid #ddd;font-weight:700;font-size:15px;color:#184B37;">${fmt(farm_net)}원</td>
        </tr>
      </tbody>
    </table>

    <p style="font-size:12px;color:#aaa;margin:0;">※ 자세한 내용은 첨부 엑셀 파일을 확인해 주세요.</p>
  </div>
</body>
</html>`;

      await sendMail({
        to,
        cc: cc || undefined,
        subject: `[덕원농장] ${batch.badge_name} 위탁사육정산서`,
        html,
        attachments: [{ filename, content: buffer }],
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Settlement send-email error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
