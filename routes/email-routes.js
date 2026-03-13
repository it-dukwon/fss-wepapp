// routes/email-routes.js
const express = require("express");
const { sendMail, buildMortalityReportHtml } = require("../utils/mailer");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = function emailRoutes({ runPgQuery, ensureAdmin }) {
  const router = express.Router();

  // POST /api/email/mortality-report
  // 폐사율 리포트 수동 발송 (관리자만)
  router.post("/mortality-report", ensureAdmin, async (req, res) => {
    try {
      const to = req.body?.to || process.env.EMAIL_RECIPIENTS;
      if (!to) return res.status(400).json({ error: "수신자 이메일이 없습니다." });

      const report = await fetchMortalityReport(runPgQuery);
      const generatedAt = dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm (KST)");
      const html = buildMortalityReportHtml(report, generatedAt);

      await sendMail({
        to,
        subject: `[덕원농장] 폐사율 오버뷰 리포트 ${dayjs().tz("Asia/Seoul").format("YYYY-MM-DD")}`,
        html,
      });

      console.log("[Email] 폐사율 리포트 발송 완료 →", to);
      res.json({ success: true, message: "이메일 발송 완료" });
    } catch (err) {
      console.error("[Email] 발송 실패:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/email/schedule
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

  // PUT /api/email/schedule (관리자만)
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

      // 서버 cron 즉시 재적용
      if (typeof global.reloadEmailCron === "function") {
        await global.reloadEmailCron();
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};

// DB에서 폐사율 리포트 조회 (server.js cron에서도 재사용)
async function fetchMortalityReport(runPgQuery) {
  const result = await runPgQuery(`
    SELECT
      b.batch_id, b.badge_name, b.manager, b.stock_in_date, b.stock_in_count, b.status,
      COALESCE(SUM(e.deaths), 0)::INT AS total_deaths,
      ROUND(
        COALESCE(SUM(e.deaths), 0)::NUMERIC / NULLIF(b.stock_in_count, 0) * 100, 2
      ) AS mortality_pct,
      ROUND(
        EXTRACT(EPOCH FROM (NOW() - b.stock_in_date::TIMESTAMPTZ)) / (30.0 * 86400), 1
      ) AS months_elapsed,
      ROUND(
        EXTRACT(EPOCH FROM (NOW() - b.stock_in_date::TIMESTAMPTZ)) / (30.0 * 86400) * 0.5, 2
      ) AS benchmark_pct
    FROM livestock_batches b
    LEFT JOIN livestock_events e ON e.batch_id = b.batch_id
    WHERE b.status = 'active'
    GROUP BY b.batch_id
    ORDER BY mortality_pct DESC NULLS LAST
  `);
  return result.rows;
}

module.exports.fetchMortalityReport = fetchMortalityReport;
