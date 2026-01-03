// routes/farms.js
const express = require("express");
const router = express.Router();

function parseDateOrNull(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d) ? null : d;
}

module.exports = function farmsRoutes({ runPgQuery }) {
  // 모든 농장 조회
  router.get("/", async (req, res) => {
    console.log("GET /api/farms 요청 도착");
    console.log("REQ", req.method, req.originalUrl, "Origin=", req.headers.origin);

    try {
      const result = await runPgQuery('SELECT * FROM list_farms ORDER BY "농장ID" ASC');
      const raw = result.rows || [];

      const farms = raw.map((row) => ({
        농장ID: row["농장ID"] ?? row.id ?? null,
        농장명: row["농장명"] ?? row.name ?? "",
        지역: row["지역"] ?? row.region ?? "",
        뱃지: row["뱃지"] ?? row.badge ?? "",
        농장주ID: row["농장주ID"] ?? row.ownerId ?? null,
        농장주: row["농장주"] ?? row.owner ?? "",
        사료회사: row["사료회사"] ?? row.feedCompany ?? "",
        관리자ID: row["관리자ID"] ?? row.managerId ?? null,
        관리자: row["관리자"] ?? row.manager ?? "",
        계약상태: row["계약상태"] ?? row.contractStatus ?? "",
        계약시작일: row["계약시작일"] ?? row.contractStart ?? null,
        계약종료일: row["계약종료일"] ?? row.contractEnd ?? null,
      }));

      res.json({ success: true, farms });
    } catch (err) {
      console.error("Get farms error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 농장 신규 등록
  router.post("/", async (req, res) => {
    try {
      const farm = req.body || {};

      const 농장명 = farm.농장명 ?? "";
      const 지역 = farm.지역 ?? null;
      const 뱃지 = farm.뱃지 ?? null;
      const 농장주ID = Number.isFinite(Number(farm.농장주ID)) ? Number(farm.농장주ID) : null;
      const 농장주 = farm.농장주 ?? null;
      const 사료회사 = farm.사료회사 ?? null;
      const 관리자ID = Number.isFinite(Number(farm.관리자ID)) ? Number(farm.관리자ID) : null;
      const 관리자 = farm.관리자 ?? null;
      const 계약상태 = farm.계약상태 ?? null;
      const 계약시작일 = parseDateOrNull(farm.계약시작일);
      const 계약종료일 = parseDateOrNull(farm.계약종료일);

      const sql = `INSERT INTO list_farms ("농장명", "지역", "뱃지", "농장주ID", "농장주", "사료회사", "관리자ID", "관리자", "계약상태", "계약시작일", "계약종료일")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

      const params = [농장명, 지역, 뱃지, 농장주ID, 농장주, 사료회사, 관리자ID, 관리자, 계약상태, 계약시작일, 계약종료일];

      await runPgQuery(sql, params);
      res.json({ message: "Farm added" });
    } catch (err) {
      console.error("Add farm error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // 농장 수정
  router.put("/:id", async (req, res) => {
    try {
      const idNum = parseInt(req.params.id, 10);
      if (Number.isNaN(idNum)) return res.status(400).json({ error: "Invalid id" });

      const farm = req.body || {};

      const 농장명 = farm.농장명 ?? "";
      const 지역 = farm.지역 ?? null;
      const 뱃지 = farm.뱃지 ?? null;
      const 농장주ID = Number.isFinite(Number(farm.농장주ID)) ? Number(farm.농장주ID) : null;
      const 농장주 = farm.농장주 ?? null;
      const 사료회사 = farm.사료회사 ?? null;
      const 관리자ID = Number.isFinite(Number(farm.관리자ID)) ? Number(farm.관리자ID) : null;
      const 관리자 = farm.관리자 ?? null;
      const 계약상태 = farm.계약상태 ?? null;
      const 계약시작일 = parseDateOrNull(farm.계약시작일);
      const 계약종료일 = parseDateOrNull(farm.계약종료일);

      const sql = `UPDATE list_farms
        SET "농장명"=$1, "지역"=$2, "뱃지"=$3, "농장주ID"=$4, "농장주"=$5, "사료회사"=$6, "관리자ID"=$7, "관리자"=$8, "계약상태"=$9, "계약시작일"=$10, "계약종료일"=$11
        WHERE "농장ID"=$12`;

      const params = [농장명, 지역, 뱃지, 농장주ID, 농장주, 사료회사, 관리자ID, 관리자, 계약상태, 계약시작일, 계약종료일, idNum];

      await runPgQuery(sql, params);
      res.json({ message: "Farm updated" });
    } catch (err) {
      console.error("Update farm error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // 농장 삭제
  router.delete("/:id", async (req, res) => {
    try {
      const idNum = parseInt(req.params.id, 10);
      if (Number.isNaN(idNum)) return res.status(400).json({ error: "Invalid id" });

      await runPgQuery(`DELETE FROM list_farms WHERE "농장ID" = $1`, [idNum]);
      res.json({ message: "Farm deleted" });
    } catch (err) {
      console.error("Delete farm error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  return router;
};
