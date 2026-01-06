// routes/board.js
const express = require("express");

module.exports = function boardRoutes({ runPgQuery, ensureAdmin }) {
  const router = express.Router();

  // ✅ ensureAdmin 주입 누락 방지: 없으면 무조건 차단
  const adminOnly =
    typeof ensureAdmin === "function"
      ? ensureAdmin
      : (req, res) => res.status(500).json({ error: "ensureAdmin middleware missing" });

  // 목록 조회 (로그인만 필요: /api 아래에 ensureAuth가 걸려있다고 가정)
  router.get("/", async (req, res) => {
    try {
      const result = await runPgQuery(
        `SELECT id, title, author_upn, created_at, updated_at
         FROM board_posts
         ORDER BY created_at DESC`
      );
      res.json({ success: true, posts: result.rows || [] });
    } catch (err) {
      console.error("Get board list error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 상세 조회
  router.get("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      const result = await runPgQuery(
        `SELECT id, title, body, author_upn, created_at, updated_at
         FROM board_posts
         WHERE id = $1`,
        [id]
      );

      res.json({ success: true, post: result.rows[0] || null });
    } catch (err) {
      console.error("Get board detail error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 등록 (관리자만)
  router.post("/", ensureAdmin, async (req, res) => {
    try {
      const title = (req.body?.title ?? "").trim();
      const body = (req.body?.body ?? "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });
      if (!body) return res.status(400).json({ error: "body is required" });

      const authorUpn = req.session?.user?.preferred_username || null;

      const result = await runPgQuery(
        `INSERT INTO board_posts (title, body, author_upn)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [title, body, authorUpn]
      );

      res.json({ success: true, id: result.rows?.[0]?.id });
    } catch (err) {
      console.error("Create board post error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 수정 (관리자만)
  router.put("/:id", ensureAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      const title = (req.body?.title ?? "").trim();
      const body = (req.body?.body ?? "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });
      if (!body) return res.status(400).json({ error: "body is required" });

      await runPgQuery(
        `UPDATE board_posts
         SET title = $1, body = $2, updated_at = NOW()
         WHERE id = $3`,
        [title, body, id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Update board post error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 삭제 (관리자만)
  router.delete("/:id", ensureAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

      await runPgQuery(`DELETE FROM board_posts WHERE id = $1`, [id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete board post error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  return router;
};
