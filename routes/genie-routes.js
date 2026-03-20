// routes/genie-routes.js
const express = require("express");
const axios   = require("axios");

const INSTANCE_URL    = "https://adb-3997551919284009.9.azuredatabricks.net";
const POLL_INTERVAL   = 2000;   // 2초 간격 폴링
const POLL_TIMEOUT    = 120000; // 2분 타임아웃

module.exports = function genieRoutes() {
  const router = express.Router();

  // ── M2M 토큰 발급 (기존 getDatabricksDashboardToken 패턴 동일) ──
  async function getM2MToken() {
    const clientId     = process.env.DATABRICKS_CLIENT_ID;
    const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("DATABRICKS_CLIENT_ID/SECRET 환경변수 없음");

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await axios.post(
      `${INSTANCE_URL}/oidc/v1/token`,
      new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
      { headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const token = res.data?.access_token;
    if (!token) throw new Error("M2M 토큰 발급 실패");
    return token;
  }

  // ── 메시지 완료 대기 폴링 ──
  async function pollMessage(token, spaceId, convId, msgId) {
    const url      = `${INSTANCE_URL}/api/2.0/genie/spaces/${spaceId}/conversations/${convId}/messages/${msgId}`;
    const deadline = Date.now() + POLL_TIMEOUT;
    let delay = POLL_INTERVAL;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, delay));
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const msg = res.data;

      if (msg.status === "COMPLETED")  return msg;
      if (["FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"].includes(msg.status)) {
        throw new Error(`Genie 응답 실패 (${msg.status}): ${msg.error || ""}`);
      }
      // 점진적 backoff (최대 8초)
      delay = Math.min(delay * 1.3, 8000);
    }
    throw new Error("Genie 응답 시간 초과 (2분)");
  }

  // ── 쿼리 결과 fetch ──
  async function fetchQueryResult(token, spaceId, convId, msgId, attachmentId) {
    const url = `${INSTANCE_URL}/api/2.0/genie/spaces/${spaceId}/conversations/${convId}/messages/${msgId}/query-result/${attachmentId}`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
  }

  // ── POST /api/genie/chat ──
  // body: { message: string, conversation_id?: string }
  router.post("/chat", async (req, res) => {
    const { message, conversation_id } = req.body;
    const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID;

    if (!message?.trim())  return res.status(400).json({ error: "질문을 입력하세요." });
    if (!spaceId)          return res.status(500).json({ error: "DATABRICKS_GENIE_SPACE_ID 환경변수가 없습니다." });

    try {
      const token = await getM2MToken();
      let convId, msgId;

      if (conversation_id) {
        // 후속 질문
        const r = await axios.post(
          `${INSTANCE_URL}/api/2.0/genie/spaces/${spaceId}/conversations/${conversation_id}/messages`,
          { content: message.trim() },
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        convId = conversation_id;
        msgId  = r.data.id;
      } else {
        // 새 대화
        const r = await axios.post(
          `${INSTANCE_URL}/api/2.0/genie/spaces/${spaceId}/start-conversation`,
          { content: message.trim() },
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        convId = r.data.conversation_id;
        msgId  = r.data.message_id;
      }

      // 완료 대기
      const completedMsg = await pollMessage(token, spaceId, convId, msgId);

      // 결과 파싱
      let answerText = null;
      let sqlQuery   = null;
      let columns    = [];
      let rows       = [];

      for (const att of completedMsg.attachments || []) {
        if (att.text?.content) {
          answerText = att.text.content;
        }
        if (att.query) {
          sqlQuery = att.query.query;
          try {
            const qr      = await fetchQueryResult(token, spaceId, convId, msgId, att.query.attachment_id);
            const schema  = qr.statement_response?.manifest?.schema?.columns || [];
            const data    = qr.statement_response?.result?.data_typed_array   || [];
            columns = schema.map(c => c.name);
            rows    = data.map(row => row.values.map(v => v.str ?? v.num ?? null));
          } catch (e) {
            console.warn("[Genie] 쿼리 결과 fetch 실패:", e.message);
          }
        }
      }

      res.json({
        success: true,
        conversation_id: convId,
        message_id: msgId,
        answer_text: answerText,
        sql_query:   sqlQuery,
        columns,
        rows,
      });
    } catch (err) {
      const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error("[Genie] chat error:", errMsg);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  return router;
};
