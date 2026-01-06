// db/pg.js
// 목적:
// - 로컬: Azure CLI(사용자 로그인) 토큰으로 Postgres Entra 접속 (AAD user token)
// - App Service(PRD): Managed Identity 토큰으로 Postgres Entra 접속 (Service Principal / MI token)
// - PGUSER는 환경에 맞게 설정:
//    - 로컬: PGUSER=gm.seo@itdukwongmail.onmicrosoft.com
//    - PRD : PGUSER=webapp-databricks-dashboard (DB에 등록된 MI principal/role 이름)

const { Pool } = require("pg");
const {
  DefaultAzureCredential,
  ManagedIdentityCredential,
  AzureCliCredential,
} = require("@azure/identity");

// Azure PostgreSQL Entra(AAD) 리소스 스코프
const AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

// ✅ pool 캐시
let cachedPool = null;
let cachedPoolExpiresAt = 0;

/**
 * 환경에 따라 "확실한" Credential을 선택
 * - App Service(Linux 포함): Managed Identity가 정석
 * - Local: Azure CLI가 제일 확실 (az login 필요)
 *
 * DefaultAzureCredential은 편하지만, 로컬에서 VSCode/ENV/CLI가 섞이면서
 * 토큰 주체가 바뀌어 auth_oid mismatch 같은 문제를 만들 수 있어
 */
function selectCredential() {
  // App Service 환경변수(있으면 거의 확정적으로 App Service)
  if (process.env.WEBSITE_INSTANCE_ID || process.env.MSI_ENDPOINT || process.env.IDENTITY_ENDPOINT) {
    return new ManagedIdentityCredential();
  }

  // 로컬에서는 Azure CLI 토큰을 추천 (az 설치 + az login 필요)
  // az가 없으면 여기서 CredentialUnavailableError 발생 -> 설치해야 함
  return new AzureCliCredential();
}

const credential = selectCredential();

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;

    // base64url -> base64 패딩 보정
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function getAccessToken() {
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

  const tokenResp = await getAccessToken();
  const accessToken = tokenResp.token;

  cachedPoolExpiresAt =
    tokenResp.expiresOnTimestamp || (now + 50 * 60 * 1000);

  // (디버그) 토큰 주체 확인용: 필요할 때만 켜기
  if (process.env.PG_DEBUG_TOKEN === "1") {
    const payload = decodeJwtPayload(accessToken);
    if (payload) {
      console.log(
        "[AAD token]",
        "oid=", payload.oid,
        "upn=", payload.upn || payload.preferred_username,
        "tid=", payload.tid,
        "appid=", payload.appid
      );
    } else {
      console.log("[AAD token] (payload decode failed)");
    }
  }

  // 기존 pool 정리
  if (cachedPool) {
    try {
      await cachedPool.end();
    } catch (_) {}
  }

  // 필수 환경변수 체크(실수 방지)
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  if (!host || !user) {
    throw new Error("Missing PGHOST or PGUSER in environment variables.");
  }

  cachedPool = new Pool({
    host,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user, // ✅ 로컬/PRD에 따라 다르게 설정
    password: accessToken, // ✅ 토큰 그대로 (Bearer 붙이면 안 됨)
    database: process.env.PGDATABASE || "postgres",
    ssl: { rejectUnauthorized: false }, // 운영은 CA 권장(연결 확인 후 강화)
    max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: process.env.PG_CONN_TIMEOUT_MS
      ? Number(process.env.PG_CONN_TIMEOUT_MS)
      : 20_000,
  });

  // 연결 직후 빠른 진단(옵션)
  // - 여기서 실패하면 네트워크/방화벽/role/토큰 문제를 빨리 알 수 있음
  if (process.env.PG_VALIDATE_ON_CREATE === "1") {
    await cachedPool.query("SELECT 1");
  }

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
