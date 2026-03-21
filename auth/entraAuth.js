// auth/entraAuth.js (CommonJS)
const crypto = require("crypto");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const { auditLog } = require("../utils/audit-log");

/**
 * Entra ID 로그인 라우터/미들웨어를 app에 장착
 * @param {import("express").Express} app
 */
function attachEntraAuth(app) {
  const {
    ENTRA_REDIRECT_URI,
    POST_LOGOUT_REDIRECT_URI,
  } = process.env;

  // Prefer AZURE_ prefixed env vars; fall back to older names if present
  const TENANT_ID = process.env.AZURE_TENANT_ID || process.env.TENANT_ID;
  const CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || process.env.CLIENT_SECRET;

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !ENTRA_REDIRECT_URI) {
    console.warn(
      "[EntraAuth] Missing env vars. Required: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ENTRA_REDIRECT_URI"
    );
  }

  const msalClient = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET,
    },
  });

  // (옵션) 세션에 로그인 사용자 저장하는 헬퍼
    function ensureAuth(req, res, next) {
    if (req.session && req.session.user) return next();

    // API 요청: redirect가 아니라 401(JSON)
    if (req.originalUrl.startsWith("/api")) {
        return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    // 페이지 요청: 로그인 페이지로 이동
    return res.redirect("/login");
    }

  // 로그인 페이지 (버튼)
  app.get("/login", (req, res) => {
    const user = req.session?.user;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>덕원농장 관리시스템 — 로그인</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 50%, #e3f2fd 100%);
    }
    .login-wrap {
      width: 100%;
      max-width: 400px;
      padding: 16px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 48px 40px 40px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.10);
      text-align: center;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 8px;
    }
    .brand {
      font-size: 22px;
      font-weight: 700;
      color: #2e7d32;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: #888;
      margin-bottom: 36px;
    }
    .divider {
      border: none;
      border-top: 1px solid #eee;
      margin: 0 0 28px;
    }
    .already {
      font-size: 14px;
      color: #444;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .already strong { color: #2e7d32; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 20px;
      border-radius: 12px;
      border: none;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    }
    .btn-ms {
      background: #146C43;
      color: #fff;
      box-shadow: 0 2px 10px rgba(20,108,67,0.25);
    }
    .btn-ms:hover { background: #0f5235; box-shadow: 0 4px 16px rgba(20,108,67,0.35); transform: translateY(-1px); }
    .btn-ms:active { transform: translateY(0); }
    .btn-ms svg { flex-shrink: 0; }
    .btn-outline {
      background: transparent;
      color: #555;
      border: 1px solid #ddd;
      margin-top: 10px;
      font-weight: 500;
      font-size: 14px;
    }
    .btn-outline:hover { background: #f7f7f7; }
    .footer {
      margin-top: 28px;
      font-size: 12px;
      color: #bbb;
    }
  </style>
</head>
<body>
  <div class="login-wrap">
    <div class="card">
      <div class="logo">🌾</div>
      <div class="brand">덕원농장</div>
      <div class="subtitle">관리시스템</div>
      <hr class="divider"/>
      ${
        user
          ? `<p class="already">이미 로그인되어 있습니다.<br/><strong>${escapeHtml(user.name || user.preferred_username || "")}</strong></p>
             <a class="btn btn-ms" href="/">홈으로 이동</a>
             <a class="btn btn-outline" href="/logout">다른 계정으로 로그인</a>`
          : `<a class="btn btn-ms" href="/auth/login">
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 21 21">
                 <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                 <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                 <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                 <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
               </svg>
               Microsoft 계정으로 로그인
             </a>`
      }
      <div class="footer">조직 Microsoft 계정으로만 접근 가능합니다.</div>
    </div>
  </div>
</body>
</html>`);
  });

  // 로그인 시작 (Auth Code + PKCE)
  app.get("/auth/login", async (req, res) => {
    try {
      const state = crypto.randomBytes(16).toString("hex");

      // PKCE
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");

      req.session.entra = { state, verifier };

      // Allow prompt override (eg. prompt=select_account) so callers can force account chooser
      const prompt = req.query?.prompt;
      const authRequest = {
        scopes: ["openid", "profile", "email"],
        redirectUri: ENTRA_REDIRECT_URI,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      };
      if (prompt) authRequest.prompt = prompt;

      const url = await msalClient.getAuthCodeUrl(authRequest);

      return res.redirect(url);
    } catch (err) {
      console.error("[EntraAuth] /auth/login error:", err);
      return res.status(500).send("Login start failed");
    }
  });

  // 콜백 (code -> token)
  app.get("/auth/redirect", async (req, res) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) return res.status(400).send("Missing code/state");
      if (!req.session.entra || state !== req.session.entra.state) {
        return res.status(400).send("Invalid state");
      }

      const tokenResponse = await msalClient.acquireTokenByCode({
        code: String(code),
        scopes: ["openid", "profile", "email"],
        redirectUri: ENTRA_REDIRECT_URI,
        codeVerifier: req.session.entra.verifier,
      });

      const claims = tokenResponse?.idTokenClaims || {};

      req.session.user = {
        name: claims.name,
        preferred_username: claims.preferred_username,
        oid: claims.oid,
        tid: claims.tid,
      };

      delete req.session.entra;

      auditLog(req, "LOGIN", "session", null,
        `로그인: ${claims.preferred_username || claims.oid}`);

      // 로그인 후 이동
      return res.redirect("/"); // 원하는 곳으로 바꿔도 됨 (예: /protected)
    } catch (err) {
      console.error("[EntraAuth] /auth/redirect error:", err);
      return res.status(500).send("Auth redirect failed");
    }
  });

  // 로그아웃 (세션 제거 + Entra 로그아웃)
  app.get("/logout", (req, res) => {
    auditLog(req, "LOGOUT", "session", null,
      `로그아웃: ${req.session?.user?.preferred_username || req.session?.user?.oid || "unknown"}`);

    req.session.destroy(() => {
      const logoutUrl =
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/logout` +
        `?post_logout_redirect_uri=${encodeURIComponent(
          POST_LOGOUT_REDIRECT_URI || "/"
        )}`;
      res.redirect(logoutUrl);
    });
  });

  // 테스트용 보호 라우트 (원하면 삭제)
  app.get("/protected", ensureAuth, (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
      <h2>보호된 페이지</h2>
      <pre>${escapeHtml(JSON.stringify(req.session.user, null, 2))}</pre>
      <p><a href="/">홈</a> | <a href="/logout">로그아웃</a></p>
    `);
  });

  // 외부에서 쓰라고 미들웨어도 내보내기 (선택)
  return { ensureAuth };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}

module.exports = { attachEntraAuth };
