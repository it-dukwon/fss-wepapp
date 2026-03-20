// routes/notice-banner-routes.js
const express = require("express");
const { auditLog } = require("../utils/audit-log");

module.exports = function noticeBannerRoutes({ runPgQuery, ensureAdmin }) {
  const router = express.Router();

  // 현재 노출 중인 공지 (로그인만 필요 — 메인 페이지 배너용)
  router.get("/active", async (req, res) => {
    try {
      const result = await runPgQuery(
        `SELECT id, message, display_from, display_to
         FROM notice_banners
         WHERE NOW() BETWEEN display_from AND display_to
         ORDER BY created_at DESC
         LIMIT 1`
      );
      res.json({ success: true, banner: result.rows[0] || null });
    } catch (err) {
      console.error("Get active banner error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 전체 목록 (관리자)
  router.get("/", ensureAdmin, async (req, res) => {
    try {
      const result = await runPgQuery(
        `SELECT id, message, display_from, display_to, created_by, created_at
         FROM notice_banners
         ORDER BY created_at DESC`
      );
      res.json({ success: true, banners: result.rows });
    } catch (err) {
      console.error("Get banners error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 등록 (관리자)
  router.post("/", ensureAdmin, async (req, res) => {
    try {
      const { message, display_from, display_to } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: "message is required" });
      if (!display_from)    return res.status(400).json({ error: "display_from is required" });
      if (!display_to)      return res.status(400).json({ error: "display_to is required" });

      const createdBy = req.session?.user?.preferred_username || null;
      const result = await runPgQuery(
        `INSERT INTO notice_banners (message, display_from, display_to, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [message.trim(), display_from, display_to, createdBy]
      );
      auditLog(req, "INSERT", "notice_banner", result.rows[0].id, `한줄공지 등록: ${message.trim().slice(0, 30)}`);
      res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
      console.error("Create banner error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 수정 (관리자)
  router.put("/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const { message, display_from, display_to } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: "message is required" });

      await runPgQuery(
        `UPDATE notice_banners SET message=$1, display_from=$2, display_to=$3 WHERE id=$4`,
        [message.trim(), display_from, display_to, id]
      );
      auditLog(req, "UPDATE", "notice_banner", id, `한줄공지 수정: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Update banner error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 삭제 (관리자)
  router.delete("/:id", ensureAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      await runPgQuery(`DELETE FROM notice_banners WHERE id=$1`, [id]);
      auditLog(req, "DELETE", "notice_banner", id, `한줄공지 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete banner error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
