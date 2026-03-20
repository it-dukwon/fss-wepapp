// routes/admin-routes.js
const express = require("express");
const { auditLog } = require("../utils/audit-log");

module.exports = function adminRoutes({ runPgQuery, ensureAdmin, invalidateAdminCache }) {
  const router = express.Router();

  // 목록 조회 (로그인 이력 유저 포함 + 접속통계)
  router.get("/", ensureAdmin, async (req, res) => {
    try {
      const r = await runPgQuery(`
        SELECT
          a.id,
          COALESCE(a.upn, l.user_upn)       AS upn,
          a.name,
          COALESCE(a.enabled, false)         AS enabled,
          a.created_at,
          COALESCE(l.login_count, 0)::INT    AS login_count,
          l.last_login
        FROM (
          SELECT
            user_upn,
            COUNT(*)::INT   AS login_count,
            MAX(created_at) AS last_login
          FROM user_activity_logs
          WHERE action = 'LOGIN' AND user_upn IS NOT NULL
          GROUP BY user_upn
        ) l
        FULL OUTER JOIN admin_users a ON lower(a.upn) = lower(l.user_upn)
        ORDER BY a.id NULLS LAST, l.last_login DESC NULLS LAST
      `);
      res.json({ success: true, admins: r.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 등록
  router.post("/", ensureAdmin, async (req, res) => {
    try {
      const upn  = (req.body?.upn  || "").trim().toLowerCase();
      const name = (req.body?.name || "").trim() || null;
      if (!upn) return res.status(400).json({ error: "upn 필수" });

      const r = await runPgQuery(
        `INSERT INTO admin_users (upn, name) VALUES ($1, $2)
         ON CONFLICT (upn) DO UPDATE SET name = EXCLUDED.name, enabled = true
         RETURNING id`,
        [upn, name]
      );
      invalidateAdminCache();
      auditLog(req, "INSERT", "admin_user", r.rows[0].id, `관리자 추가: ${upn}`);
      res.json({ success: true, id: r.rows[0].id });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 수정 (이름 / enabled)
  router.put("/:id", ensureAdmin, async (req, res) => {
    try {
      const id      = parseInt(req.params.id, 10);
      const name    = (req.body?.name ?? "").trim() || null;
      const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true;

      await runPgQuery(
        `UPDATE admin_users SET name=$1, enabled=$2 WHERE id=$3`,
        [name, enabled, id]
      );
      invalidateAdminCache();
      auditLog(req, "UPDATE", "admin_user", id, `관리자 수정: id=${id}, enabled=${enabled}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 삭제
  router.delete("/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      // 자기 자신은 삭제 불가
      const selfUpn = req.session?.user?.preferred_username?.toLowerCase();
      const target  = await runPgQuery(`SELECT upn FROM admin_users WHERE id=$1`, [id]);
      if (target.rows[0]?.upn?.toLowerCase() === selfUpn) {
        return res.status(400).json({ error: "자기 자신은 삭제할 수 없습니다." });
      }

      await runPgQuery(`DELETE FROM admin_users WHERE id=$1`, [id]);
      invalidateAdminCache();
      auditLog(req, "DELETE", "admin_user", id, `관리자 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
