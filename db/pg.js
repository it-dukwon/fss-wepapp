// db/pg.js
const { Pool } = require("pg");
const { DefaultAzureCredential } = require("@azure/identity");

const credential = new DefaultAzureCredential();

// ✅ pool 변수명 중복 방지
let cachedPool = null;
let cachedPoolExpiresAt = 0;

// Azure PostgreSQL Entra(AAD) 리소스 스코프
const AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

async function getToken() {
  const tokenResp = await credential.getToken(AAD_SCOPE);
  if (!tokenResp?.token) {
    throw new Error("Failed to acquire AAD token for PostgreSQL.");
  }
  return tokenResp;
}

async function getPool() {
  const now = Date.now();

  // 만료 2분 전이면 새로 발급
  if (cachedPool && now < cachedPoolExpiresAt - 2 * 60 * 1000) {
    return cachedPool;
  }

  const tokenResp = await getToken();
  const accessToken = tokenResp.token;
  cachedPoolExpiresAt = tokenResp.expiresOnTimestamp || (now + 50 * 60 * 1000);

  // 기존 pool 정리
  if (cachedPool) {
    try {
      await cachedPool.end();
    } catch (_) {}
  }

  cachedPool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER, // 예: gm.seo@itdukwongmail.onmicrosoft.com
    password: accessToken, // ✅ 토큰 그대로 (Bearer 붙이면 안 됨)
    database: process.env.PGDATABASE || "postgres",
    ssl: { rejectUnauthorized: false },
    max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return cachedPool;
}

async function runPgQuery(text, params) {
  const pool = await getPool();
  return pool.query(text, params);
}

async function closePool() {
  if (cachedPool) {
    try {
      await cachedPool.end();
    } catch (_) {}
    cachedPool = null;
  }
}

module.exports = { getPool, runPgQuery, closePool };

