require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require('cors');
const fs = require("fs");
const { DataLakeServiceClient } = require("@azure/storage-file-datalake");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
const axios = require("axios");
const { DBSQLClient } = require('@databricks/sql');
const { Pool } = require('pg');

const session = require("express-session");
const { attachEntraAuth } = require("./auth/entraAuth");


dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;


// Postgres pool (use DATABASE_URL or individual PG_* env vars)
const basePgConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    };

// ✅ Azure PostgreSQL은 SSL 필수인 경우가 대부분이라 강제
const pool = new Pool({
  ...basePgConfig,
  ssl: { rejectUnauthorized: false }, // 우선 연결 확인용 (운영은 CA 권장)
});



const { DefaultAzureCredential } = require("@azure/identity");
const credential = new DefaultAzureCredential();

let pool = null;
let poolExpiresAt = 0;

async function getPgPool() {
  const now = Date.now();

  if (pool && now < poolExpiresAt - 2 * 60 * 1000) return pool;

  const tokenResp = await credential.getToken(
    "https://ossrdbms-aad.database.windows.net/.default"
  );

  const accessToken = tokenResp.token;
  poolExpiresAt = tokenResp.expiresOnTimestamp || (now + 50 * 60 * 1000);

  if (pool) {
    try { await pool.end(); } catch (_) {}
  }

  pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER,
    password: accessToken,              // ✅ 토큰
    database: process.env.PGDATABASE || "postgres",
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

async function runPgQuery(text, params) {
  const p = await getPgPool();
  return p.query(text, params);
}



function parseDateOrNull(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d) ? null : d;
}









// 세션 (Entra 로그인용) - CORS credentials 쓰면 sameSite/secure도 같이 봐야 함
app.set("trust proxy", 1); // App Service/프록시 환경 대비

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // 운영 HTTPS면 true로 바꾸는 게 좋음 (아래 참고)
    },
  })
);

const { ensureAuth } = attachEntraAuth(app);




/**
 * 1) 요청 로깅 미들웨어 - 반드시 가장 먼저 등록
 *    정적 파일 요청도 포함해 모든 요청이 로그에 찍히도록 함
 */
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.originalUrl, 'Origin=', req.headers.origin || '-');
  next();
});

/**
 * 2) CORS 설정 - whitelist 검사 후 요청 Origin을 반사(reflect)하도록 처리
 *    credentials: true 이므로 Access-Control-Allow-Origin은 '*'가 될 수 없음
 */
const whitelist = [
  'http://localhost:3000',
  'https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net'
];

const corsOptions = {
  origin: function(origin, callback) {
    // origin이 없는 경우(server-to-server 요청, curl 등)는 허용
    if (!origin) return callback(null, true);
    if (whitelist.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
// 명시적으로 OPTIONS 프리플라이트 처리
app.options('*', cors(corsOptions));

/**
 * 3) 바디 파서 등 전역 미들웨어
 */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/api/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.status(401).json({ authenticated: false });
});

app.use("/api", ensureAuth);                 // 그 다음에 보호

/**
 * 4) 정적 파일 서빙 (public 폴더)
 *    정적 파일은 여기서 서빙되며, 위의 로깅 미들웨어로 요청이 찍힙니다.
 */
app.use(express.static(path.join(__dirname, "public")));






// --- 메인 페이지 & 파일 업로드 ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/upload", upload.single("xlsFile"), async (req, res) => {
  const filePath = req.file.path;
  const timestamp = dayjs().tz("Asia/Seoul").format("YYYYMMDD_HHmmss");
  const fileName = `${timestamp}.xls`;

  try {
    const serviceClient = DataLakeServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const fileSystemClient = serviceClient.getFileSystemClient(process.env.AZURE_STORAGE_CONTAINER);

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

// --- Databricks OAuth 토큰 발급 ---
async function getDatabricksToken() {
  if (process.env.DATABRICKS_TOKEN) {
    return process.env.DATABRICKS_TOKEN;
  }
  try {
    const tokenEndpoint = process.env.DATABRICKS_TOKEN_ENDPOINT || "https://accounts.azuredatabricks.net/oauth2/token";

    const response = await axios.post(
      tokenEndpoint,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.DATABRICKS_CLIENT_ID,
        client_secret: process.env.DATABRICKS_CLIENT_SECRET,
        scope: "all",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0 }
    );

    console.log('Token response data (partial):', JSON.stringify(response.data).slice(0, 300));

    if (response.data && response.data.access_token) {
      return response.data.access_token;
    }
    throw new Error('No access_token in token response');
  } catch (error) {
    console.error('Token fetch error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
}

// --- Databricks SQL 쿼리 실행 헬퍼 함수 ---
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
      const queryOperation = await session.executeStatement(sql, { runAsync: true });
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

// --- 유틸 함수들 ---
function escapeSqlString(s) {
  if (s === null || s === undefined) return null;
  return String(s).replace(/'/g, "''");
}

function sqlDateOrNull(dateStr) {
  if (!dateStr) return 'NULL';
  const d = new Date(dateStr);
  if (isNaN(d)) return 'NULL';
  return `DATE '${d.toISOString().slice(0,10)}'`;
}

function toDateInputValue(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}







// --- CRUD API: list_farms 테이블 ---

// 모든 농장 조회
app.get("/api/farms", async (req, res) => {
  console.log("GET /api/farms 요청 도착");
  console.log('REQ', req.method, req.originalUrl, 'Origin=', req.headers.origin);

  try {
    const result = await runPgQuery('SELECT * FROM list_farms ORDER BY "농장ID" ASC');
    const raw = result.rows || [];

    const farms = raw.map(row => ({
      농장ID: row['농장ID'] ?? row.id ?? null,
      농장명: row['농장명'] ?? row.name ?? '',
      지역: row['지역'] ?? row.region ?? '',
      뱃지: row['뱃지'] ?? row.badge ?? '',
      농장주ID: row['농장주ID'] ?? row.ownerId ?? null,
      농장주: row['농장주'] ?? row.owner ?? '',
      사료회사: row['사료회사'] ?? row.feedCompany ?? '',
      관리자ID: row['관리자ID'] ?? row.managerId ?? null,
      관리자: row['관리자'] ?? row.manager ?? '',
      계약상태: row['계약상태'] ?? row.contractStatus ?? '',
      계약시작일: row['계약시작일'] ?? row.contractStart ?? null,
      계약종료일: row['계약종료일'] ?? row.contractEnd ?? null,
    }));

    res.json({ success: true, farms });
  } catch (err) {
    console.error("Get farms error:", err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// 농장 신규 등록
app.post("/api/farms", async (req, res) => {
  try {
    const farm = req.body || {};

    const 농장명 = farm.농장명 ?? '';
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

// 농장 수정 (농장ID 기준)
app.put("/api/farms/:id", async (req, res) => {
  try {
    const idNum = parseInt(req.params.id, 10);
    if (Number.isNaN(idNum)) return res.status(400).json({ error: 'Invalid id' });

    const farm = req.body || {};

    const 농장명 = farm.농장명 ?? '';
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

    const sql = `UPDATE list_farms SET "농장명"=$1, "지역"=$2, "뱃지"=$3, "농장주ID"=$4, "농장주"=$5, "사료회사"=$6, "관리자ID"=$7, "관리자"=$8, "계약상태"=$9, "계약시작일"=$10, "계약종료일"=$11 WHERE "농장ID"=$12`;
    const params = [농장명, 지역, 뱃지, 농장주ID, 농장주, 사료회사, 관리자ID, 관리자, 계약상태, 계약시작일, 계약종료일, idNum];

    await runPgQuery(sql, params);

    res.json({ message: "Farm updated" });
  } catch (err) {
    console.error("Update farm error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// 농장 삭제 (농장ID 기준)
app.delete("/api/farms/:id", async (req, res) => {
  try {
    const idNum = parseInt(req.params.id, 10);
    if (Number.isNaN(idNum)) return res.status(400).json({ error: 'Invalid id' });

    const sql = `DELETE FROM list_farms WHERE "농장ID" = $1`;
    await runPgQuery(sql, [idNum]);

    res.json({ message: "Farm deleted" });
  } catch (err) {
    console.error("Delete farm error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// --- Databricks SQL 테스트용 간단 API ---
app.get("/api/dbsql", async (req, res) => {
  try {
    const token = await getDatabricksToken();
    const server_hostname = process.env.DATABRICKS_SERVER_HOST;
    const http_path = process.env.DATABRICKS_HTTP_PATH;

    if (!token || !server_hostname || !http_path) {
      return res.status(400).json({ error: "Missing Databricks configuration (token/host/path)." });
    }

    const client = new DBSQLClient();

    await client.connect({
      token: token,
      host: server_hostname,
      path: http_path,
    });

    const session = await client.openSession();

    const queryOperation = await session.executeStatement("SELECT 1", { runAsync: true });

    const result = await queryOperation.fetchAll();
    await queryOperation.close();

    await session.close();
    await client.close();

    res.json({ result });
  } catch (error) {
    console.error("Databricks SQL error:", error.response?.data || error.message || error);
    res.status(500).json({ error: error.response?.data || error.message || String(error) });
  }
});

// --- iframe 페이지: Databricks Dashboard ---
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

// --- 서버 시작 ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

