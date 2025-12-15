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

app.use(cors({
  origin: [
    // '*',
    'http://localhost:3000',
    'https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net'
  ],
  credentials: true,
}));

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
    const token = await getDatabricksToken();
    const raw = await runDatabricksSQL(token, "SELECT * FROM dbx_dukwon.auto_dukwon.list_farms ORDER BY `농장ID` ASC;");

    console.log('/api/farms raw result (sample):', JSON.stringify(raw).slice(0, 1000));

    let farms = [];

    // 1) [{col:val,...}, ...] 형태
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && !Array.isArray(raw[0])) {
      farms = raw.map(row => ({
        농장ID: row["농장ID"] ?? row["id"] ?? row["농장_id"] ?? null,
        농장명: row["농장명"] ?? row["name"] ?? '',
        지역: row["지역"] ?? row["region"] ?? '',
        뱃지: row["뱃지"] ?? row["badge"] ?? '',
        농장주ID: row["농장주ID"] ?? row["ownerId"] ?? null,
        농장주: row["농장주"] ?? row["owner"] ?? '',
        사료회사: row["사료회사"] ?? row["feedCompany"] ?? '',
        관리자ID: row["관리자ID"] ?? row["managerId"] ?? null,
        관리자: row["관리자"] ?? row["manager"] ?? '',
        계약상태: row["계약상태"] ?? row["contractStatus"] ?? '',
        계약시작일: row["계약시작일"] ?? row["contractStart"] ?? null,
        계약종료일: row["계약종료일"] ?? row["contractEnd"] ?? null,
      }));
    }
    // 2) [[val1,val2,...], ...] 형태 (컬럼 순서를 알고 있을 때)
    else if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      farms = raw.map(r => ({
        농장ID: r[0],
        농장명: r[1],
        지역: r[2],
        뱃지: r[3],
        농장주ID: r[4],
        농장주: r[5],
        사료회사: r[6],
        관리자ID: r[7],
        관리자: r[8],
        계약상태: r[9],
        계약시작일: r[10],
        계약종료일: r[11],
      }));
    }
    // 3) {columns: [...], rows: [...]} 형태
    else if (raw && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
      const cols = raw.columns.map(c => c.name || c.columnName || c);
      farms = raw.rows.map(row => {
        const obj = {};
        row.forEach((val, idx) => { obj[cols[idx]] = val; });
        return {
          농장ID: obj["농장ID"] ?? obj["id"] ?? null,
          농장명: obj["농장명"] ?? obj["name"] ?? '',
          지역: obj["지역"] ?? obj["region"] ?? '',
          뱃지: obj["뱃지"] ?? obj["badge"] ?? '',
          농장주ID: obj["농장주ID"] ?? obj["ownerId"] ?? null,
          농장주: obj["농장주"] ?? obj["owner"] ?? '',
          사료회사: obj["사료회사"] ?? obj["feedCompany"] ?? '',
          관리자ID: obj["관리자ID"] ?? obj["managerId"] ?? null,
          관리자: obj["관리자"] ?? obj["manager"] ?? '',
          계약상태: obj["계약상태"] ?? obj["contractStatus"] ?? '',
          계약시작일: obj["계약시작일"] ?? obj["contractStart"] ?? null,
          계약종료일: obj["계약종료일"] ?? obj["contractEnd"] ?? null,
        };
      });
    } else {
      console.warn('Unknown result shape from Databricks:', typeof raw);
    }

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
    const token = await getDatabricksToken();

    const 농장명 = escapeSqlString(farm.농장명) ?? '';
    const 지역 = escapeSqlString(farm.지역) ?? '';
    const 뱃지 = escapeSqlString(farm.뱃지) ?? '';
    const 농장주ID = Number.isFinite(Number(farm.농장주ID)) ? Number(farm.농장주ID) : 'NULL';
    const 농장주 = escapeSqlString(farm.농장주) ?? '';
    const 사료회사 = escapeSqlString(farm.사료회사) ?? '';
    const 관리자ID = Number.isFinite(Number(farm.관리자ID)) ? Number(farm.관리자ID) : 'NULL';
    const 관리자 = escapeSqlString(farm.관리자) ?? '';
    const 계약상태 = escapeSqlString(farm.계약상태) ?? '';
    const 계약시작일 = sqlDateOrNull(farm.계약시작일);
    const 계약종료일 = sqlDateOrNull(farm.계약종료일);

    const sql = `
      INSERT INTO dbx_dukwon.auto_dukwon.list_farms
        (\`농장명\`, \`지역\`, \`뱃지\`, \`농장주ID\`, \`농장주\`, \`사료회사\`, \`관리자ID\`, \`관리자\`, \`계약상태\`, \`계약시작일\`, \`계약종료일\`)
      VALUES (
        '${농장명}',
        '${지역}',
        '${뱃지}',
        ${농장주ID === 'NULL' ? 'NULL' : 농장주ID},
        '${농장주}',
        '${사료회사}',
        ${관리자ID === 'NULL' ? 'NULL' : 관리자ID},
        '${관리자}',
        '${계약상태}',
        ${계약시작일},
        ${계약종료일}
      )
    `;

    console.log('INSERT SQL:', sql.slice(0, 1000));
    await runDatabricksSQL(token, sql);

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
    const token = await getDatabricksToken();

    const 농장명 = escapeSqlString(farm.농장명) ?? '';
    const 지역 = escapeSqlString(farm.지역) ?? '';
    const 뱃지 = escapeSqlString(farm.뱃지) ?? '';
    const 농장주ID = Number.isFinite(Number(farm.농장주ID)) ? Number(farm.농장주ID) : 'NULL';
    const 농장주 = escapeSqlString(farm.농장주) ?? '';
    const 사료회사 = escapeSqlString(farm.사료회사) ?? '';
    const 관리자ID = Number.isFinite(Number(farm.관리자ID)) ? Number(farm.관리자ID) : 'NULL';
    const 관리자 = escapeSqlString(farm.관리자) ?? '';
    const 계약상태 = escapeSqlString(farm.계약상태) ?? '';
    const 계약시작일 = sqlDateOrNull(farm.계약시작일);
    const 계약종료일 = sqlDateOrNull(farm.계약종료일);

    const sql = `
      UPDATE dbx_dukwon.auto_dukwon.list_farms SET
        \`농장명\` = '${농장명}',
        \`지역\` = '${지역}',
        \`뱃지\` = '${뱃지}',
        \`농장주ID\` = ${농장주ID === 'NULL' ? 'NULL' : 농장주ID},
        \`농장주\` = '${농장주}',
        \`사료회사\` = '${사료회사}',
        \`관리자ID\` = ${관리자ID === 'NULL' ? 'NULL' : 관리자ID},
        \`관리자\` = '${관리자}',
        \`계약상태\` = '${계약상태}',
        \`계약시작일\` = ${계약시작일},
        \`계약종료일\` = ${계약종료일}
      WHERE \`농장ID\` = ${idNum}
    `;

    console.log('UPDATE SQL:', sql);
    await runDatabricksSQL(token, sql);

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

    const sql = `DELETE FROM dbx_dukwon.auto_dukwon.list_farms WHERE \`농장ID\` = ${idNum}`;
    console.log('DELETE SQL:', sql);

    const token = await getDatabricksToken();
    await runDatabricksSQL(token, sql);

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

