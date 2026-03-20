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

  // 표시 이름 저장 (비관리자 포함 — enabled=false로 upsert, 기존 enabled는 유지)
  router.patch("/name", ensureAdmin, async (req, res) => {
    try {
      const upn  = (req.body?.upn  || "").trim().toLowerCase();
      const name = (req.body?.name || "").trim() || null;
      if (!upn) return res.status(400).json({ error: "upn 필수" });

      await runPgQuery(
        `INSERT INTO admin_users (upn, name, enabled)
         VALUES ($1, $2, false)
         ON CONFLICT (upn) DO UPDATE SET name = EXCLUDED.name`,
        [upn, name]
      );
      invalidateAdminCache();
      auditLog(req, "UPDATE", "admin_user", null, `표시이름 저장: ${upn} → ${name}`);
      res.json({ success: true });
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

  // Notion 동기화 (admin_users → Notion "22. 관리자 리스트")
  router.post("/sync-notion", ensureAdmin, async (req, res) => {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const NOTION_DB_ID = "2dd11794-eab5-801b-bb2c-f904cc44adb2";

    if (!NOTION_TOKEN) {
      return res.status(500).json({ error: "NOTION_API_TOKEN 환경변수 없음" });
    }

    async function notionApi(method, path, body) {
      const https = require("https");
      const data = body ? JSON.stringify(body) : null;
      return new Promise((resolve, reject) => {
        const r = https.request({
          hostname: "api.notion.com", path: `/v1${path}`, method,
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
            ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          },
        }, (resp) => {
          let raw = "";
          resp.on("data", (c) => (raw += c));
          resp.on("end", () => resolve({ status: resp.statusCode, body: JSON.parse(raw) }));
        });
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
      });
    }

    try {
      // DB 조회
      const { rows: admins } = await runPgQuery(
        `SELECT upn, name, enabled, created_at FROM admin_users ORDER BY id`, []
      );

      // Notion 기존 항목 조회 (UPN → page_id 맵)
      const existing = await notionApi("POST", `/databases/${NOTION_DB_ID}/query`, { page_size: 100 });
      const notionMap = {};
      for (const page of existing.body.results || []) {
        const upn = page.properties?.UPN?.email;
        if (upn) notionMap[upn] = page.id;
      }

      let created = 0, updated = 0;
      for (const admin of admins) {
        const props = {
          이름:   { title: [{ text: { content: admin.name || admin.upn } }] },
          UPN:    { email: admin.upn },
          활성화:  { checkbox: admin.enabled },
          등록일:  { date: { start: new Date(admin.created_at).toISOString().split("T")[0] } },
        };
        if (notionMap[admin.upn]) {
          await notionApi("PATCH", `/pages/${notionMap[admin.upn]}`, { properties: props });
          updated++;
        } else {
          await notionApi("POST", "/pages", { parent: { database_id: NOTION_DB_ID }, properties: props });
          created++;
        }
      }

      res.json({ success: true, created, updated, total: admins.length });
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
