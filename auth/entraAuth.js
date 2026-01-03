// auth/entraAuth.js (CommonJS)
const crypto = require("crypto");
const { ConfidentialClientApplication } = require("@azure/msal-node");

/**
 * Entra ID 로그인 라우터/미들웨어를 app에 장착
 * @param {import("express").Express} app
 */
function attachEntraAuth(app) {
  const {
    TENANT_ID,
    CLIENT_ID,
    CLIENT_SECRET,
    ENTRA_REDIRECT_URI,
    POST_LOGOUT_REDIRECT_URI,
  } = process.env;

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !ENTRA_REDIRECT_URI) {
    console.warn(
      "[EntraAuth] Missing env vars. Required: TENANT_ID, CLIENT_ID, CLIENT_SECRET, ENTRA_REDIRECT_URI"
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
  <title>로그인</title>
  <style>
    body{font-family:system-ui,Segoe UI,Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:720px;margin:40px auto;padding:0 16px}
    .card{border:1px solid #ddd;border-radius:14px;padding:20px}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #333;text-decoration:none;color:#111}
    .btn.primary{background:#111;color:#fff}
    pre{background:#f6f6f6;padding:12px;border-radius:10px;overflow:auto}
  </style>
</head>
<body>
  <div class="card">
    <h1>덕원농장 관리 시스템 로그인</h1>
    ${
      user
        ? `<p>이미 로그인됨: <b>${escapeHtml(user.name || user.preferred_username || user.oid)}</b></p>
           <p><a class="btn" href="/protected">보호된 페이지</a> <a class="btn" href="/logout">로그아웃</a></p>
           <pre>${escapeHtml(JSON.stringify(user, null, 2))}</pre>`
        : `<p><a class="btn primary" href="/auth/login">Microsoft로 로그인</a></p>`
    }
    <p style="color:#666">Redirect URI: ${escapeHtml(ENTRA_REDIRECT_URI || "")}</p>
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

      const url = await msalClient.getAuthCodeUrl({
        scopes: ["openid", "profile", "email"],
        redirectUri: ENTRA_REDIRECT_URI,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      });

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

      // 로그인 후 이동
      return res.redirect("/"); // 원하는 곳으로 바꿔도 됨 (예: /protected)
    } catch (err) {
      console.error("[EntraAuth] /auth/redirect error:", err);
      return res.status(500).send("Auth redirect failed");
    }
  });

  // 로그아웃 (세션 제거 + Entra 로그아웃)
  app.get("/logout", (req, res) => {
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
