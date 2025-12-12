require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { DataLakeServiceClient } = require("@azure/storage-file-datalake");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
const axios = require("axios");
const { DBSQLClient } = require('@databricks/sql');

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

const cors = require('cors');

// CORS 설정: origin을 배열로 처리하거나 필요 시 와일드카드(*) 사용 가능
// origin에 배열 넣기
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net'
  ],
  credentials: true,
}));

// CORS Debug용 미들웨어
// app.use((req, res, next) => {
//   console.log('CORS Debug - Origin:', req.headers.origin);
//   next();
// });

app.use(express.json());
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
    console.error("❌ 업로드 실패:", err.message);
    res.status(500).json({ message: "❌ 업로드 실패" });
  }
});

// --- Databricks OAuth 토큰 발급 ---

async function getDatabricksToken() {
  if (process.env.DATABRICKS_TOKEN) {
    // console.log('Using DATABRICKS_TOKEN from environment');
    return process.env.DATABRICKS_TOKEN;
  }
  try {
    const tokenEndpoint = process.env.DATABRICKS_TOKEN_ENDPOINT || "https://accounts.azuredatabricks.net/oauth2/token";
    // console.log('Requesting token from:', tokenEndpoint);

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
    // console.log('Token response status:', response.status);
    // console.log('Token response data (partial):', JSON.stringify(response.data).slice(0, 300));

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

      // console.log("Query result fetched:", result);

      await queryOperation.close();
      return result;
    } finally {
      await session.close();
    }
  } finally {
    await client.close();
  }
}


// --- CRUD API: list_farms 테이블 ---

// 모든 농장 조회
app.get("/api/farms", async (req, res) => {
  try {
    const token = await getDatabricksToken();
    const farms = await runDatabricksSQL(token, "SELECT * FROM dbx_dukwon.auto_dukwon.list_farms");

    // console.log("Farms from query:", farms);

    // farms가 배열 맞으면 이렇게 보내고,
    res.json({ success: true, farms });
  } catch (err) {
    console.error("Get farms error:", err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// 농장 신규 등록
app.post("/api/farms", async (req, res) => {
  try {
    const farm = req.body;
    const token = await getDatabricksToken();

    const sql = `
      INSERT INTO dbx_dukwon.auto_dukwon.list_farms VALUES (
        ${farm.관리자ID || 0},
        '${farm.관리자 || ""}',
        ${farm.농장ID || 0},
        '${farm.농장명 || ""}',
        '${farm.뱃지 || ""}',
        '${farm.농장주 || ""}',
        '${farm.지역 || ""}',
        '${farm.사료회사 || ""}',
        '${farm.계약상태 || ""}',
        DATE '${farm.계약시작일 || "1970-01-01"}',
        DATE '${farm.계약종료일 || "1970-01-01"}'
      )
    `;

    await runDatabricksSQL(token, sql);

    res.json({ message: "Farm added" });
  } catch (err) {
    console.error("Add farm error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 농장 수정 (농장ID 기준)
app.put("/api/farms/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const farm = req.body;
    const token = await getDatabricksToken();

    const sql = `
      UPDATE dbx_dukwon.auto_dukwon.list_farms SET
        관리자ID = ${farm.관리자ID || 0},
        관리자 = '${farm.관리자 || ""}',
        농장명 = '${farm.농장명 || ""}',
        뱃지 = '${farm.뱃지 || ""}',
        농장주 = '${farm.농장주 || ""}',
        지역 = '${farm.지역 || ""}',
        사료회사 = '${farm.사료회사 || ""}',
        계약상태 = '${farm.계약상태 || ""}',
        계약시작일 = DATE '${farm.계약시작일 || "1970-01-01"}',
        계약종료일 = DATE '${farm.계약종료일 || "1970-01-01"}'
      WHERE 농장ID = ${id}
    `;

    await runDatabricksSQL(token, sql);

    res.json({ message: "Farm updated" });
  } catch (err) {
    console.error("Update farm error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 농장 삭제 (농장ID 기준)
app.delete("/api/farms/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const token = await getDatabricksToken();

    const sql = `DELETE FROM dbx_dukwon.auto_dukwon.list_farms WHERE 농장ID = ${id}`;

    await runDatabricksSQL(token, sql);

    res.json({ message: "Farm deleted" });
  } catch (err) {
    console.error("Delete farm error:", err.message);
    res.status(500).json({ error: err.message });
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
  // console.log(`Server running on http://localhost:${PORT}`);
});
