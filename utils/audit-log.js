// utils/audit-log.js
// DB 변경 작업에 대한 사용자 활동 로그를 user_activity_logs 테이블에 기록합니다.
// auditLog는 fire-and-forget (실패해도 API 응답에 영향 없음)

const { runPgQuery } = require("../db/pg");

/**
 * @param {import('express').Request} req
 * @param {'INSERT'|'UPDATE'|'DELETE'|'START'|'STOP'} action
 * @param {string} resourceType  예: 'farm', 'feed_company', 'manager', 'livestock_batch', 'livestock_event', 'board_post', 'db_server'
 * @param {string|number|null} resourceId  대상 레코드의 PK
 * @param {string} summary  사람이 읽기 좋은 요약
 */
function auditLog(req, action, resourceType, resourceId, summary) {
  const user = req?.session?.user || {};
  const userUpn  = user.preferred_username || null;
  const userName = user.name || null;
  const rid = resourceId != null ? String(resourceId) : null;

  runPgQuery(
    `INSERT INTO user_activity_logs (user_upn, user_name, action, resource_type, resource_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userUpn, userName, action, resourceType, rid, summary]
  ).catch((err) => {
    console.error("[AuditLog] 로그 기록 실패:", err.message);
  });
}

module.exports = { auditLog };
