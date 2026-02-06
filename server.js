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

// ADMIN_UPNS 환경변수 → Set으로 변환
const ADMIN_UPNS = new Set(
  (process.env.ADMIN_UPNS || "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);

function isAdminUser(req) {
  const upn = req.session?.user?.preferred_username;
  if (!upn) return false;
  return ADMIN_UPNS.has(String(upn).toLowerCase());
}

function ensureAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdminUser(req)) return res.status(403).json({ error: "Forbidden" });
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
app.get("/api/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json({
      authenticated: true,
      user: req.session.user,
      isAdmin: isAdminUser(req),
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

app.use("/api/farms", farmsRoutes({ runPgQuery }));
app.use("/api/board", boardRoutes({ runPgQuery, ensureAdmin }));
app.use("/api/azure-postgres", azurePgRoutes({ ensureAdmin }));

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
// 서버 시작
// ------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

