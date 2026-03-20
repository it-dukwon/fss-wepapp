/**
 * scripts/sync-admin-to-notion.js
 *
 * PostgreSQL admin_users 테이블 → Notion "22. 관리자 리스트" DB 동기화
 *
 * 실행 방법:
 *   az login  (로컬 최초 1회)
 *   node scripts/sync-admin-to-notion.js
 *
 * 동작:
 *   - DB에서 admin_users 전체 조회
 *   - Notion DB의 기존 항목을 UPN 기준으로 비교
 *   - 없으면 CREATE, 있으면 UPDATE (이름/활성화 상태 반영)
 */

require("dotenv").config();
const { runPgQuery, closePool } = require("../db/pg");

const NOTION_TOKEN = process.env.NOTION_API_TOKEN || "ntn_b46906026778F4q2kZrXTcMbwyCKdJ4D7ij5oIyUFWX4QL";
const NOTION_DB_ID = "2dd11794-eab5-801b-bb2c-f904cc44adb2";
const NOTION_VERSION = "2022-06-28";

async function notionApi(method, path, body) {
  const https = require("https");
  const data = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.notion.com",
        path: `/v1${path}`,
        method,
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getNotionAdmins() {
  // Notion DB 전체 조회
  const res = await notionApi("POST", `/databases/${NOTION_DB_ID}/query`, { page_size: 100 });
  return res.body.results || [];
}

async function main() {
  console.log("▶ PostgreSQL admin_users 조회 중...");
  const { rows: dbAdmins } = await runPgQuery(
    `SELECT id, upn, name, enabled, created_at FROM admin_users ORDER BY id`,
    []
  );
  console.log(`  DB 관리자 수: ${dbAdmins.length}명`);

  console.log("▶ Notion 기존 데이터 조회 중...");
  const notionPages = await getNotionAdmins();
  // UPN → page_id 맵
  const notionMap = {};
  for (const page of notionPages) {
    const upn = page.properties?.UPN?.email;
    if (upn) notionMap[upn] = page.id;
  }
  console.log(`  Notion 기존 항목: ${notionPages.length}개`);

  let created = 0, updated = 0;

  for (const admin of dbAdmins) {
    const props = {
      이름: { title: [{ text: { content: admin.name || admin.upn } }] },
      UPN: { email: admin.upn },
      활성화: { checkbox: admin.enabled },
      등록일: { date: { start: new Date(admin.created_at).toISOString().split("T")[0] } },
    };

    if (notionMap[admin.upn]) {
      // UPDATE
      await notionApi("PATCH", `/pages/${notionMap[admin.upn]}`, { properties: props });
      console.log(`  ↑ 업데이트: ${admin.upn}`);
      updated++;
    } else {
      // CREATE
      await notionApi("POST", "/pages", {
        parent: { database_id: NOTION_DB_ID },
        properties: props,
      });
      console.log(`  + 추가: ${admin.upn}`);
      created++;
    }
  }

  console.log(`\n✔ 완료 — 추가: ${created}개, 업데이트: ${updated}개`);
  await closePool();
}

main().catch(async (err) => {
  console.error("오류:", err.message);
  await closePool();
  process.exit(1);
});
