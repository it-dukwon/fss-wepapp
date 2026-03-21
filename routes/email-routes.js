// routes/email-routes.js
const express = require("express");
const { sendMail, buildMortalityReportHtml } = require("../utils/mailer");
const { auditLog } = require("../utils/audit-log");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = function emailRoutes({ runPgQuery, ensureAdmin }) {
  const router = express.Router();

  // ─────────────────────────────────────────────────────────
  // 이메일 수신자 CRUD
  // ─────────────────────────────────────────────────────────

  // GET /api/email/recipients?alert_type=mortality_report
  router.get("/recipients", async (req, res) => {
    try {
      const { alert_type } = req.query;
      const where = alert_type ? `WHERE alert_type = $1` : "";
      const params = alert_type ? [alert_type] : [];
      const result = await runPgQuery(
        `SELECT id, email, name, alert_type, enabled, note, created_at
         FROM email_recipients
         ${where}
         ORDER BY alert_type, id`,
        params
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/email/recipients
  router.post("/recipients", ensureAdmin, async (req, res) => {
    try {
      const { email, name, alert_type, enabled, note } = req.body;
      if (!email) return res.status(400).json({ success: false, error: "이메일은 필수입니다." });
      const result = await runPgQuery(
        `INSERT INTO email_recipients (email, name, alert_type, enabled, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          email.trim(),
          name?.trim() || null,
          alert_type || "mortality_report",
          enabled !== false,
          note?.trim() || null,
        ]
      );
      auditLog(req, "INSERT", "email_recipient", result.rows[0].id, `이메일 수신자 등록: ${email.trim()}`);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/email/recipients/:id
  router.put("/recipients/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { email, name, alert_type, enabled, note } = req.body;
      if (!email) return res.status(400).json({ success: false, error: "이메일은 필수입니다." });
      await runPgQuery(
        `UPDATE email_recipients
         SET email=$1, name=$2, alert_type=$3, enabled=$4, note=$5
         WHERE id=$6`,
        [
          email.trim(),
          name?.trim() || null,
          alert_type || "mortality_report",
          enabled !== false,
          note?.trim() || null,
          id,
        ]
      );
      auditLog(req, "UPDATE", "email_recipient", id, `이메일 수신자 수정: ${email.trim()}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/email/recipients/:id
  router.delete("/recipients/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await runPgQuery(`DELETE FROM email_recipients WHERE id=$1`, [id]);
      auditLog(req, "DELETE", "email_recipient", id, `이메일 수신자 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/email/mortality-report — 폐사율 리포트 수동 발송
  // ─────────────────────────────────────────────────────────
  router.post("/mortality-report", ensureAdmin, async (req, res) => {
    try {
      // 요청 body에 to가 있으면 우선 사용, 없으면 DB 수신자 목록
      let toStr = (req.body?.to || "").trim();
      if (!toStr) {
        const toList = await getEnabledRecipients(runPgQuery, "mortality_report");
        toStr = toList.length > 0 ? toList.join(",") : (process.env.EMAIL_RECIPIENTS || "");
      }
      if (!toStr) {
        return res.status(400).json({ success: false, error: "수신자 이메일이 없습니다." });
      }

      const ccStr = (req.body?.cc || "").trim() || undefined;

      const report = await fetchMortalityReport(runPgQuery);
      const generatedAt = dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm (KST)");
      const html = buildMortalityReportHtml(report, generatedAt);

      await sendMail({
        to: toStr,
        cc: ccStr,
        subject: `[덕원농장] 폐사율 오버뷰 리포트 ${dayjs().tz("Asia/Seoul").format("YYYY-MM-DD")}`,
        html,
      });

      console.log("[Email] 폐사율 리포트 발송 완료 →", toStr);
      res.json({ success: true, message: "이메일 발송 완료" });
    } catch (err) {
      console.error("[Email] 발송 실패:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/email/schedule
  // PUT /api/email/schedule
  // ─────────────────────────────────────────────────────────
  router.get("/schedule", async (req, res) => {
    try {
      const result = await runPgQuery(
        `SELECT value FROM app_settings WHERE key = 'email_mortality_schedule'`
      );
      const value = result.rows[0]?.value
        ? JSON.parse(result.rows[0].value)
        : { enabled: true, dayOfWeek: 1, hour: 9, minute: 0 };
      res.json({ success: true, schedule: value });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put("/schedule", ensureAdmin, async (req, res) => {
    try {
      const { enabled, dayOfWeek, hour, minute } = req.body;
      const value = JSON.stringify({
        enabled: !!enabled,
        dayOfWeek: Number(dayOfWeek),
        hour: Number(hour),
        minute: Number(minute),
      });
      await runPgQuery(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('email_mortality_schedule', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [value]
      );

      if (typeof global.reloadEmailCron === "function") {
        await global.reloadEmailCron();
      }

      auditLog(req, "UPDATE", "email_schedule", null, `이메일 발송 스케줄 변경: ${value}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};

// ─────────────────────────────────────────────────────────────
// 헬퍼: DB에서 활성 수신자 이메일 배열 반환
// ─────────────────────────────────────────────────────────────
async function getEnabledRecipients(runPgQuery, alertType) {
  try {
    const result = await runPgQuery(
      `SELECT email FROM email_recipients WHERE alert_type=$1 AND enabled=true ORDER BY id`,
      [alertType]
    );
    return result.rows.map(r => r.email);
  } catch (_) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// DB에서 폐사율 리포트 조회 (server.js cron에서도 재사용)
// ─────────────────────────────────────────────────────────────
async function fetchMortalityReport(runPgQuery) {
  const metaRes = await runPgQuery(`SELECT value FROM app_settings WHERE key = 'mortality_benchmark_monthly_pct'`);
  const benchmarkRate = parseFloat(metaRes.rows[0]?.value ?? "0.5");

  const result = await runPgQuery(`
    SELECT
      b.batch_id,
      b.badge_name,
      b.manager,
      p.pass_name,
      TO_CHAR(COALESCE(MAX(CASE WHEN e.transfer_in > 0 THEN e.event_date END), b.stock_in_date), 'YYYY-MM-DD') AS stock_in_date,
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
    LEFT JOIN livestock_passes p ON p.batch_id = b.batch_id AND p.status = 'active'
    WHERE b.status = 'active'
    GROUP BY b.batch_id, p.pass_name
    ORDER BY mortality_pct DESC NULLS LAST
  `);

  return result.rows.map((r) => {
    const months = parseFloat(r.months_elapsed) || 0;
    const benchmarkPct = Math.round(months * benchmarkRate * 100) / 100;
    const mortalityPct = parseFloat(r.mortality_pct) || 0;
    return {
      ...r,
      benchmark_pct: benchmarkPct,
      diff_pct: Math.round((mortalityPct - benchmarkPct) * 100) / 100,
    };
  });
}

module.exports.fetchMortalityReport = fetchMortalityReport;
module.exports.getEnabledRecipients = getEnabledRecipients;
