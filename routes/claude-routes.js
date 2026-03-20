// routes/claude-routes.js
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

module.exports = function claudeRoutes() {
  const router = express.Router();

  // POST /api/claude/chat
  // body: { message: string, history?: [{role, content}] }
  router.post("/chat", async (req, res) => {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: "질문을 입력하세요." });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수가 없습니다." });
    }

    try {
      const client = new Anthropic({ apiKey });

      // 이전 대화 + 현재 질문 구성
      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: message.trim() },
      ];

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: "당신은 덕원농장 관리 시스템의 AI 어시스턴트입니다. 농장 운영, 데이터 분석, 업무 관련 질문에 친절하고 정확하게 답변해주세요. 한국어로 답변해주세요.",
        messages,
      });

      const answerText = response.content?.[0]?.text || "";

      res.json({
        success: true,
        answer: answerText,
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      });
    } catch (err) {
      const errMsg = err.message || "알 수 없는 오류";
      console.error("[Claude] chat error:", errMsg);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  return router;
};
