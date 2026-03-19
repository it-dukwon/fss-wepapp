// routes/farms-routes.js
const express = require("express");
const { auditLog } = require("../utils/audit-log");

function parseDateOrNull(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d) ? null : d;
}

module.exports = function farmsRoutes({ runPgQuery }) {
  const router = express.Router();

  // ═══════════════════════════════════════════════════════════
  // 사료회사 (feed_companies)
  // ═══════════════════════════════════════════════════════════
  router.get("/feed-companies", async (req, res) => {
    try {
      const r = await runPgQuery(`SELECT id, company_name, note FROM feed_companies ORDER BY id ASC`);
      res.json({ success: true, data: r.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/feed-companies", async (req, res) => {
    try {
      const { company_name, note } = req.body || {};
      if (!company_name) return res.status(400).json({ error: "company_name 필수" });
      const r = await runPgQuery(
        `INSERT INTO feed_companies (company_name, note) VALUES ($1,$2) RETURNING id`,
        [company_name.trim(), note || null]
      );
      auditLog(req, "INSERT", "feed_company", r.rows[0].id, `사료회사 등록: ${company_name.trim()}`);
      res.json({ success: true, id: r.rows[0].id });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put("/feed-companies/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { company_name, note } = req.body || {};
      await runPgQuery(
        `UPDATE feed_companies SET company_name=$1, note=$2 WHERE id=$3`,
        [company_name?.trim(), note || null, id]
      );
      auditLog(req, "UPDATE", "feed_company", id, `사료회사 수정: ${company_name?.trim()}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete("/feed-companies/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await runPgQuery(`DELETE FROM feed_companies WHERE id=$1`, [id]);
      auditLog(req, "DELETE", "feed_company", id, `사료회사 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 관리자 (managers)
  // ═══════════════════════════════════════════════════════════
  router.get("/managers", async (req, res) => {
    try {
      const r = await runPgQuery(`
        SELECT m.id, m.manager_name, m.feed_company_id, m.phone, m.note,
               fc.company_name
        FROM managers m
        LEFT JOIN feed_companies fc ON fc.id = m.feed_company_id
        ORDER BY m.id ASC
      `);
      res.json({ success: true, data: r.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/managers", async (req, res) => {
    try {
      const { manager_name, feed_company_id, phone, note } = req.body || {};
      if (!manager_name) return res.status(400).json({ error: "manager_name 필수" });
      const r = await runPgQuery(
        `INSERT INTO managers (manager_name, feed_company_id, phone, note) VALUES ($1,$2,$3,$4) RETURNING id`,
        [manager_name.trim(), feed_company_id || null, phone || null, note || null]
      );
      auditLog(req, "INSERT", "manager", r.rows[0].id, `관리자 등록: ${manager_name.trim()}`);
      res.json({ success: true, id: r.rows[0].id });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put("/managers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { manager_name, feed_company_id, phone, note } = req.body || {};
      await runPgQuery(
        `UPDATE managers SET manager_name=$1, feed_company_id=$2, phone=$3, note=$4 WHERE id=$5`,
        [manager_name?.trim(), feed_company_id || null, phone || null, note || null, id]
      );
      auditLog(req, "UPDATE", "manager", id, `관리자 수정: ${manager_name?.trim()}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete("/managers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await runPgQuery(`DELETE FROM managers WHERE id=$1`, [id]);
      auditLog(req, "DELETE", "manager", id, `관리자 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 농장 (list_farms)
  // ═══════════════════════════════════════════════════════════
  router.get("/", async (req, res) => {
    try {
      const r = await runPgQuery(`
        SELECT
          f."농장ID", f."농장명", f."지역", f."농장주",
          f."계약상태", f."계약시작일", f."계약종료일",
          f.feed_company_id, fc.company_name AS feed_company_name,
          f.manager_id, m.manager_name
        FROM list_farms f
        LEFT JOIN feed_companies fc ON fc.id = f.feed_company_id
        LEFT JOIN managers m ON m.id = f.manager_id
        ORDER BY f."농장ID" ASC
      `);
      const farms = r.rows.map(row => ({
        농장ID:          row["농장ID"],
        농장명:          row["농장명"] ?? "",
        지역:            row["지역"] ?? "",
        농장주:          row["농장주"] ?? "",
        feed_company_id: row.feed_company_id,
        사료회사:        row.feed_company_name ?? "",
        manager_id:      row.manager_id,
        관리자:          row.manager_name ?? "",
        계약상태:        row["계약상태"] ?? "",
        계약시작일:      row["계약시작일"],
        계약종료일:      row["계약종료일"],
      }));
      res.json({ success: true, farms });
    } catch (err) {
      console.error("Get farms error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const b = req.body || {};
      await runPgQuery(
        `INSERT INTO list_farms ("농장명","지역","농장주","계약상태","계약시작일","계약종료일",feed_company_id,manager_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          b.농장명 || "", b.지역 || null, b.농장주 || null,
          b.계약상태 || null,
          parseDateOrNull(b.계약시작일), parseDateOrNull(b.계약종료일),
          b.feed_company_id || null, b.manager_id || null,
        ]
      );
      auditLog(req, "INSERT", "farm", null, `농장 등록: ${b.농장명 || ""}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Add farm error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const b = req.body || {};
      await runPgQuery(
        `UPDATE list_farms
         SET "농장명"=$1,"지역"=$2,"농장주"=$3,"계약상태"=$4,"계약시작일"=$5,"계약종료일"=$6,
             feed_company_id=$7, manager_id=$8
         WHERE "농장ID"=$9`,
        [
          b.농장명 || "", b.지역 || null, b.농장주 || null,
          b.계약상태 || null,
          parseDateOrNull(b.계약시작일), parseDateOrNull(b.계약종료일),
          b.feed_company_id || null, b.manager_id || null,
          id,
        ]
      );
      auditLog(req, "UPDATE", "farm", id, `농장 수정: ${b.농장명 || ""}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Update farm error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await runPgQuery(`DELETE FROM list_farms WHERE "농장ID"=$1`, [id]);
      auditLog(req, "DELETE", "farm", id, `농장 삭제: id=${id}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete farm error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
