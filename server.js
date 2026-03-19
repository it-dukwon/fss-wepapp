// server.js
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const fs = require("fs");
const { DataLakeServiceClient } = require("@azure/storage-file-datalake");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
const axios = require("axios");
const { DBSQLClient } = require("@databricks/sql");

const session = require("express-session");
const { attachEntraAuth } = require("./auth/entraAuth");

// ✅ 분리한 모듈
const { runPgQuery, closePool } = require("./db/pg");
const farmsRoutes = require("./routes/farms-routes");
const boardRoutes = require("./routes/board-routes");
const azurePgRoutes = require("./routes/azure-postgres-routes");
const livestockRoutes = require("./routes/livestock-routes");
const emailRoutes = require("./routes/email-routes");
const adminRoutes = require("./routes/admin-routes");
const cron = require("node-cron");
const { sendMail, buildMortalityReportHtml } = require("./utils/mailer");
const { fetchMortalityReport, getEnabledRecipients } = require("./routes/email-routes");

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// 세션 (Entra 로그인용)
// ------------------------------------------------------------
app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // 운영 HTTPS면 true로 변경 권장
    },
  })
);

// Entra 라우트 등록 (/login, /auth/login, /auth/redirect, /logout)
const { ensureAuth } = attachEntraAuth(app);

// ── 관리자 캐시 (DB에서 읽어 1분간 유지) ──────────────────────
let _adminCache = null;
let _adminCacheExpiry = 0;

// admin-routes에서 변경 후 캐시 무효화용
function invalidateAdminCache() {
  _adminCache = null;
  _adminCacheExpiry = 0;
}

async function getAdminUpns() {
  const now = Date.now();
  if (_adminCache && now < _adminCacheExpiry) return _adminCache;
  try {
    const r = await runPgQuery(`SELECT upn FROM admin_users WHERE enabled = true`);
    _adminCache = new Set(r.rows.map(row => row.upn.toLowerCase()));
    _adminCacheExpiry = now + 60 * 1000; // 1분 캐시
    return _adminCache;
  } catch (err) {
    // DB 장애 시 환경변수 폴백
    console.error("[AdminCache] DB 조회 실패, 환경변수 폴백:", err.message);
    return new Set(
      (process.env.ADMIN_UPNS || "")
        .split(",").map(v => v.trim().toLowerCase()).filter(Boolean)
    );
  }
}

async function isAdminUser(req) {
  const upn = req.session?.user?.preferred_username;
  if (!upn) return false;
  const admins = await getAdminUpns();
  return admins.has(String(upn).toLowerCase());
}

async function ensureAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!await isAdminUser(req)) return res.status(403).json({ error: "Forbidden" });
  next();
}


// ------------------------------------------------------------
// 1) 요청 로깅 (가장 먼저)
// ------------------------------------------------------------
app.use((req, res, next) => {
  console.log(
    new Date().toISOString(),
    req.method,
    req.originalUrl,
    "Origin=",
    req.headers.origin || "-"
  );
  next();
});

// ------------------------------------------------------------
// 2) CORS
// ------------------------------------------------------------
const whitelist = [
  "http://localhost:3000",
  "https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net",
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (whitelist.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ------------------------------------------------------------
// 3) 바디 파서
// ------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ------------------------------------------------------------
// 로그인 상태 확인용 (예외: /api 보호 전에 둬야 함)
// ------------------------------------------------------------
app.get("/api/me", async (req, res) => {
  if (req.session && req.session.user) {
    return res.json({
      authenticated: true,
      user: req.session.user,
      isAdmin: await isAdminUser(req),
    });
  }
  return res.status(401).json({ authenticated: false, isAdmin: false });
});

console.log("ensureAdmin typeof:", typeof ensureAdmin);

// ------------------------------------------------------------
// /api 보호
// ------------------------------------------------------------
app.use("/api", ensureAuth);

// ------------------------------------------------------------
// 정적 파일
// ------------------------------------------------------------
// Auto-start trigger: run startAzurePostgres once on first incoming request
app.use((req, res, next) => {
  if (!global.__dbAutoStarted) {
    global.__dbAutoStarted = true;
    (async () => {
      try {
        console.log('[AutoDB] background start triggered by first request', req.originalUrl);
        await startAzurePostgres();
        console.log('[AutoDB] background start completed');
      } catch (err) {
        console.error('[AutoDB] background start failed:', err.response?.data || err.message || err);
      }
    })();
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// aibi-client 라이브러리 브라우저에 서빙
app.use(
  "/vendor/aibi-client",
  express.static(path.join(__dirname, "node_modules/@databricks/aibi-client/dist"))
);

// ------------------------------------------------------------
// 메인 페이지
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));

  
  console.log("Main page loaded:", req.session?.user?.preferred_username || "No user");

  // Auto-start DB once per server process on first web visit (dev convenience).
  if (!global.__dbAutoStarted) {
    global.__dbAutoStarted = true;

    console.log("global.__dbAutoStarted :", global.__dbAutoStarted);

    (async () => {
      try {
        console.log('[AutoDB] attempting to start Azure Postgres (background)');
        await startAzurePostgres();
        console.log('[AutoDB] start request sent');
      } catch (err) {
        console.error('[AutoDB] start failed:', err.response?.data || err.message || err);
      }
    })();
  }
});

// ------------------------------------------------------------
// 업로드
// ------------------------------------------------------------
app.post("/upload", upload.single("xlsFile"), async (req, res) => {
  const filePath = req.file.path;
  const timestamp = dayjs().tz("Asia/Seoul").format("YYYYMMDD_HHmmss");
  const fileName = `${timestamp}.xls`;

  try {
    const serviceClient = DataLakeServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
    const fileSystemClient = serviceClient.getFileSystemClient(
      process.env.AZURE_STORAGE_CONTAINER
    );

    const exists = await fileSystemClient.exists();
    if (!exists) {
      return res.status(400).json({ message: "❌ File system does not exist." });
    }

    const fileClient = fileSystemClient.getFileClient(fileName);

    await fileClient.create();
    const fileContent = fs.readFileSync(filePath);
    await fileClient.append(fileContent, 0, fileContent.length);
    await fileClient.flush(fileContent.length);

    fs.unlinkSync(filePath);
    res.json({ message: "✅ 업로드 성공!", fileName });
  } catch (err) {
    console.error("❌ 업로드 실패:", err.message || err);
    res.status(500).json({ message: "❌ 업로드 실패" });
  }
});

// ------------------------------------------------------------
// Databricks OAuth 토큰 발급
// ------------------------------------------------------------
async function getDatabricksToken() {
  if (process.env.DATABRICKS_TOKEN) {
    return process.env.DATABRICKS_TOKEN;
  }

  const tokenEndpoint =
    process.env.DATABRICKS_TOKEN_ENDPOINT ||
    "https://accounts.azuredatabricks.net/oauth2/token";

  try {
    const response = await axios.post(
      tokenEndpoint,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.DATABRICKS_CLIENT_ID,
        client_secret: process.env.DATABRICKS_CLIENT_SECRET,
        scope: "all",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        maxRedirects: 0,
      }
    );

    console.log(
      "Token response data (partial):",
      JSON.stringify(response.data).slice(0, 300)
    );

    if (response.data && response.data.access_token) {
      return response.data.access_token;
    }
    throw new Error("No access_token in token response");
  } catch (error) {
    console.error(
      "Token fetch error:",
      error.response?.status,
      error.response?.data || error.message
    );
    throw error;
  }
}

// ------------------------------------------------------------
// Databricks SQL 쿼리 실행
// ------------------------------------------------------------
async function runDatabricksSQL(token, sql) {
  const server_hostname = process.env.DATABRICKS_SERVER_HOST;
  const http_path = process.env.DATABRICKS_HTTP_PATH;

  if (!token || !server_hostname || !http_path) {
    throw new Error("Missing Databricks configuration (token/host/path).");
  }

  const client = new DBSQLClient();

  try {
    await client.connect({
      token,
      host: server_hostname,
      path: http_path,
    });

    const session = await client.openSession();

    try {
      const queryOperation = await session.executeStatement(sql, {
        runAsync: true,
      });
      const result = await queryOperation.fetchAll();

      await queryOperation.close();
      return result;
    } finally {
      await session.close();
    }
  } finally {
    await client.close();
  }
}

// ------------------------------------------------------------
// CRUD 라우터
// ------------------------------------------------------------
// Auto-start helper: obtain ARM token and call the management API start action
async function startAzurePostgres(opts = {}) {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Missing Azure AD creds (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET)');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://management.azure.com/.default',
  });

  const tokenResp = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const token = tokenResp.data?.access_token;
  if (!token) throw new Error('Failed to get ARM token');

  const subscriptionId = opts.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = opts.resourceGroup || process.env.AZURE_RESOURCE_GROUP;
  const serverName = opts.serverName || process.env.AZURE_PG_SERVER_NAME;

  if (!subscriptionId || !resourceGroup || !serverName) {
    throw new Error('Missing target .env: AZURE_SUBSCRIPTION_ID/AZURE_RESOURCE_GROUP/AZURE_PG_SERVER_NAME');
  }

  const apiVersion = process.env.AZURE_MGMT_API_VERSION || '2021-06-01';
  const url = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${encodeURIComponent(serverName)}/start?api-version=${apiVersion}`;

  return axios.post(url, {}, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
}

// GET /api/dashboard/token — 대시보드 임베드용 scoped 토큰 발급 (3단계)
app.get("/api/dashboard/token", ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const token = await getDatabricksDashboardToken(user);
    res.json({ success: true, token });
  } catch (err) {
    console.error("[Dashboard token] 발급 실패:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function getDatabricksDashboardToken(user) {
  const instanceUrl = "https://adb-3997551919284009.9.azuredatabricks.net";
  const dashboardId = "01f0bba8df9b1c0ebcf5dc38714d79aa";
  const clientId     = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("DATABRICKS_CLIENT_ID/SECRET 환경변수가 없습니다");

  // Basic Auth 헤더 (공식 방식)
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const authHeader = { "Authorization": `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" };

  // 1단계: all-apis M2M 토큰
  const step1 = await axios.post(
    `${instanceUrl}/oidc/v1/token`,
    new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
    { headers: authHeader }
  );
  const m2mToken = step1.data?.access_token;
  if (!m2mToken) throw new Error("Step1: access_token 없음");
  console.log("[Dashboard token] Step1 M2M 토큰 성공");

  // 2단계: published/tokeninfo — dashboard_id가 포함된 authorization_details 반환
  const viewerId = encodeURIComponent(user?.preferred_username || user?.oid || "viewer");
  const viewerValue = encodeURIComponent(user?.name || "viewer");
  const step2 = await axios.get(
    `${instanceUrl}/api/2.0/lakeview/dashboards/${dashboardId}/published/tokeninfo?external_viewer_id=${viewerId}&external_value=${viewerValue}`,
    { headers: { Authorization: `Bearer ${m2mToken}` } }
  );
  const tokenInfo = step2.data;
  console.log("[Dashboard token] Step2 tokeninfo 성공:", JSON.stringify(tokenInfo).slice(0, 200));

  // 3단계: authorization_details를 포함한 scoped 토큰 발급
  const { authorization_details, ...rest } = tokenInfo;
  const params = new URLSearchParams({
    ...rest,
    grant_type: "client_credentials",
    authorization_details: JSON.stringify(authorization_details),
  });
  const step3 = await axios.post(
    `${instanceUrl}/oidc/v1/token`,
    params,
    { headers: authHeader }
  );
  const scopedToken = step3.data?.access_token;
  if (!scopedToken) throw new Error("Step3: scoped token 없음");
  console.log("[Dashboard token] Step3 scoped 토큰 발급 성공");
  return scopedToken;
}

app.use("/api/farms", farmsRoutes({ runPgQuery }));
app.use("/api/board", boardRoutes({ runPgQuery, ensureAdmin }));
app.use("/api/azure-postgres", azurePgRoutes({ ensureAdmin }));
app.use("/api/livestock", livestockRoutes({ runPgQuery }));
app.use("/api/email", emailRoutes({ runPgQuery, ensureAdmin }));
app.use("/api/admins", adminRoutes({ runPgQuery, ensureAdmin, invalidateAdminCache }));

// ------------------------------------------------------------
// 사용자 활동 로그 조회 (관리자 전용)
// ------------------------------------------------------------
app.get("/api/audit-logs", ensureAdmin, async (req, res) => {
  try {
    const page        = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit       = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset      = (page - 1) * limit;
    const resourceType = req.query.resource_type || null;
    const userUpn     = req.query.user_upn       || null;
    const dateFrom    = req.query.date_from       || null;
    const dateTo      = req.query.date_to         || null;

    const conditions = [];
    const params     = [];

    if (resourceType) { params.push(resourceType); conditions.push(`resource_type = $${params.length}`); }
    if (userUpn)      { params.push(`%${userUpn}%`); conditions.push(`user_upn ILIKE $${params.length}`); }
    if (dateFrom)     { params.push(dateFrom); conditions.push(`created_at >= $${params.length}`); }
    if (dateTo)       { params.push(dateTo);   conditions.push(`created_at <  ($${params.length}::date + interval '1 day')`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await runPgQuery(
      `SELECT COUNT(*) AS total FROM user_activity_logs ${where}`, params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit);
    params.push(offset);
    const dataResult = await runPgQuery(
      `SELECT id, created_at, user_upn, user_name, action, resource_type, resource_id, summary
       FROM user_activity_logs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, logs: dataResult.rows, total, page, limit });
  } catch (err) {
    console.error("[AuditLog API] 오류:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Switch account: destroy session and return login redirect URL
app.post("/api/switch-account", ensureAuth, (req, res) => {
  console.log('[SwitchAccount] POST called by', req.session?.user?.preferred_username || 'unknown');
  const sid = req.sessionID;
  req.session.destroy((err) => {
    if (err) {
      console.error('[SwitchAccount] destroy error:', err);
      return res.status(500).json({ error: 'Failed to destroy session' });
    }
    try { res.clearCookie('connect.sid'); } catch (e) {}
    console.log('[SwitchAccount] session destroyed', sid);
    res.json({ redirect: "/auth/login" });
  });
});

// Public shortcut to switch account: clear session and redirect to Entra login
app.get('/switch-account', (req, res) => {
  console.log('[SwitchAccount] GET called, user:', req.session?.user?.preferred_username || 'unknown');
  const sid = req.sessionID;
  req.session.destroy((err) => {
    if (err) {
      console.error('[SwitchAccount] destroy error:', err);
      // still redirect to login to allow user to re-authenticate
      return res.redirect('/auth/login');
    }
    try { res.clearCookie('connect.sid'); } catch (e) {}
    console.log('[SwitchAccount] session destroyed (GET)', sid);
    // Redirect to Entra login with account chooser
    res.redirect('/auth/login?prompt=select_account');
  });
});


// ------------------------------------------------------------
// Databricks SQL 테스트용
// ------------------------------------------------------------
app.get("/api/dbsql", async (req, res) => {
  try {
    const token = await getDatabricksToken();

    if (!process.env.DATABRICKS_SERVER_HOST || !process.env.DATABRICKS_HTTP_PATH) {
      return res
        .status(400)
        .json({ error: "Missing Databricks configuration (host/path)." });
    }

    const result = await runDatabricksSQL(token, "SELECT 1");
    res.json({ result });
  } catch (error) {
    console.error("Databricks SQL error:", error.response?.data || error.message || error);
    res
      .status(500)
      .json({ error: error.response?.data || error.message || String(error) });
  }
});

// ------------------------------------------------------------
// iframe 페이지: Databricks Dashboard // 단순 테스트용
// ------------------------------------------------------------
app.get("/dashboard", (req, res) => {
  res.send(`
    <html>
      <head><title>Databricks Dashboard</title></head>
      <body>
        <h1>Databricks Dashboard</h1>
        <iframe
          src="${process.env.DATABRICKS_DASHBOARD_URL}"
          width="100%"
          height="600"
          frameborder="0"
        ></iframe>
      </body>
    </html>
  `);
});



// ------------------------------------------------------------
// 게시판 리스트/상세 페이지 (정적 파일 sendFile)
// ------------------------------------------------------------
app.get("/board", ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "detail", "board.html"));
});

app.get("/board/:id", ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "detail", "board-detail.html"));
});


// ------------------------------------------------------------
// 종료 처리(로컬 개발 편의)
// ------------------------------------------------------------
process.on("SIGINT", async () => {
  try {
    await closePool();
  } finally {
    process.exit(0);
  }
});

// ------------------------------------------------------------
// 폐사율 리포트 자동 발송 cron (DB 설정 기반, 동적 재적용 가능)
// ------------------------------------------------------------
let _emailCronJob = null;

async function reloadEmailCron() {
  // 기존 cron 중지
  if (_emailCronJob) { _emailCronJob.stop(); _emailCronJob = null; }

  try {
    const result = await runPgQuery(`SELECT value FROM app_settings WHERE key = 'email_mortality_schedule'`);
    const cfg = result.rows[0]?.value
      ? JSON.parse(result.rows[0].value)
      : { enabled: true, dayOfWeek: 1, hour: 9, minute: 0 };

    if (!cfg.enabled) { console.log("[Cron] 이메일 자동발송 비활성화됨"); return; }

    // KST → UTC 변환
    const utcHour = ((cfg.hour - 9) + 24) % 24;
    // 자정을 넘기면 요일도 하루 앞당김
    const dayWrap = cfg.hour < 9 ? 1 : 0;
    const utcDay = ((cfg.dayOfWeek - dayWrap) + 7) % 7;
    const cronExpr = `${cfg.minute} ${utcHour} * * ${utcDay}`;

    _emailCronJob = cron.schedule(cronExpr, async () => {
      console.log("[Cron] 폐사율 리포트 자동 발송 시작");
      // DB 수신자 목록 우선, 없으면 .env 폴백
      const dbRecipients = await getEnabledRecipients(runPgQuery, "mortality_report");
      const to = dbRecipients.length > 0
        ? dbRecipients.join(",")
        : (process.env.EMAIL_RECIPIENTS || null);
      if (!to) { console.warn("[Cron] 수신자 없음, 발송 생략"); return; }
      try {
        const report = await fetchMortalityReport(runPgQuery);
        const generatedAt = dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm (KST)");
        const html = buildMortalityReportHtml(report, generatedAt);
        await sendMail({
          to,
          subject: `[덕원농장] 주간 폐사율 오버뷰 리포트 ${dayjs().tz("Asia/Seoul").format("YYYY-MM-DD")}`,
          html,
        });
        console.log("[Cron] 발송 완료 →", to);
      } catch (err) {
        console.error("[Cron] 발송 실패:", err.message);
      }
    });

    const days = ["일", "월", "화", "수", "목", "금", "토"];
    console.log(`[Cron] 이메일 스케줄 등록: 매주 ${days[cfg.dayOfWeek]}요일 ${String(cfg.hour).padStart(2,"0")}:${String(cfg.minute).padStart(2,"0")} KST (cron: ${cronExpr})`);
  } catch (err) {
    console.error("[Cron] 스케줄 로드 실패:", err.message);
  }
}

// 전역 노출 (email-routes에서 재적용 호출용)
global.reloadEmailCron = reloadEmailCron;

// ------------------------------------------------------------
// 서버 시작
// ------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  reloadEmailCron().catch((err) => console.error("[Cron] 초기화 실패:", err.message));
});

