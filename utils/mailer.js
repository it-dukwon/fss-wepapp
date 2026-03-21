// utils/mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * 이메일 발송
 * @param {Object} opts
 * @param {string|string[]} opts.to   수신자
 * @param {string}          opts.subject
 * @param {string}          opts.html
 */
async function sendMail({ to, cc, subject, html, attachments }) {
  return transporter.sendMail({
    from: `"덕원농장 관리시스템" <${process.env.GMAIL_USER}>`,
    to:   Array.isArray(to) ? to.join(", ") : to,
    cc:   cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : undefined,
    subject,
    html,
    attachments,
  });
}

/**
 * 폐사율 리포트 HTML 생성
 */
function buildMortalityReportHtml(report, generatedAt) {
  const rows = report.map((r) => {
    const mortality = parseFloat(r.mortality_pct) || 0;
    const benchmark = parseFloat(r.benchmark_pct) || 0;
    const diff = parseFloat(r.diff_pct) || 0;
    const diffStr = (diff >= 0 ? "+" : "") + diff.toFixed(2) + "%p";
    let statusColor, statusLabel;
    if (mortality <= benchmark)             { statusColor = "#146C43"; statusLabel = "✅ 양호"; }
    else if (mortality <= benchmark * 1.5)  { statusColor = "#e07800"; statusLabel = "⚠️ 주의"; }
    else                                    { statusColor = "#d9534f"; statusLabel = "🔴 불량"; }

    return `
      <tr>
        <td style="font-weight:700;">${r.badge_name}</td>
        <td>${r.manager || "-"}</td>
        <td>${r.stock_in_date ? String(r.stock_in_date).slice(0, 10) : "-"}</td>
        <td>${r.stock_in_count ?? "-"}</td>
        <td>${r.days_elapsed != null ? `${r.days_elapsed}일 / ${r.months_elapsed}월` : "-"}</td>
        <td style="color:#d9534f;font-weight:600;">${r.total_deaths ?? 0}</td>
        <td>${benchmark.toFixed(2)}%</td>
        <td style="color:${mortality > benchmark ? "#d9534f" : "#333"};font-weight:600;">${mortality.toFixed(2)}% <span style="font-size:0.85em;color:${diff > 0 ? "#d9534f" : "#146C43"};">(${diffStr})</span></td>
        <td style="color:${statusColor};font-weight:700;">${statusLabel}</td>
      </tr>`;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8" /></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f5f7f6;padding:24px;">
  <div style="max-width:860px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 4px;color:#184B37;">덕원농장 폐사율 오버뷰 리포트</h2>
    <p style="margin:0 0 20px;color:#888;font-size:13px;">생성일시: ${generatedAt}</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f0f4f0;">
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">뱃지명</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">관리자</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">입식일</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">입식두수</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">경과일/경과월</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">누적폐사</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">벤치마크</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">누적폐사율</th>
          <th style="padding:9px 10px;border:1px solid #ddd;text-align:center;">평가</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="9" style="text-align:center;padding:16px;color:#aaa;">활성 뱃지 없음</td></tr>'}
      </tbody>
    </table>

    <p style="margin:18px 0 0;font-size:12px;color:#aaa;">
      ※ 벤치마크: 월 0.5% / 총 2% (입식 후 120일 기준)<br/>
      ※ 양호: 폐사율 ≤ 벤치마크 &nbsp;|&nbsp; 주의: 벤치마크 ~1.5배 &nbsp;|&nbsp; 불량: 1.5배 초과
    </p>
  </div>
</body>
</html>`;
}

module.exports = { sendMail, buildMortalityReportHtml };
