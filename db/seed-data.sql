-- ============================================================
-- 덕원농장 초기 데이터 세팅
-- 실행 전 주의: 기존 데이터 전체 삭제 후 재입력
-- 실행 순서: FK 역순으로 DELETE → 정순으로 INSERT
-- ============================================================

-- ── 1. 기존 데이터 삭제 ──────────────────────────────────────
DELETE FROM livestock_events;
DELETE FROM livestock_batches;
DELETE FROM list_farms;
DELETE FROM managers;
DELETE FROM feed_companies;

-- 시퀀스 리셋
ALTER SEQUENCE feed_companies_id_seq RESTART WITH 1;
ALTER SEQUENCE managers_id_seq RESTART WITH 1;
ALTER SEQUENCE livestock_batches_batch_id_seq RESTART WITH 1;
ALTER SEQUENCE livestock_events_event_id_seq RESTART WITH 1;


-- ── 2. 사료회사 ──────────────────────────────────────────────
INSERT INTO feed_companies (id, company_name, note) VALUES
  (1, '카길애그리퓨리나', 'Cargill Agri Purina Korea'),
  (2, 'TS사료',           null),
  (3, '선진사료',         '(주)선진'),
  (4, '팜스코',           'CJ Feed & Care');

SELECT setval('feed_companies_id_seq', 4);


-- ── 3. 관리자 ────────────────────────────────────────────────
INSERT INTO managers (id, manager_name, feed_company_id, phone, note) VALUES
  (1, '김기훈', 1, null, null),
  (2, '마준언', 1, null, null),
  (3, '신현준', 1, null, null),
  (4, '최윤혁', 2, null, null),
  (5, '이영운', 3, null, null),
  (6, '정종원', 4, null, null);

SELECT setval('managers_id_seq', 6);


-- ── 4. 농장 (뱃지 제외, 기본 농장 단위) ──────────────────────
-- feed_company_id / manager_id FK 연결
INSERT INTO list_farms ("농장ID","농장명","지역","농장주","계약상태", feed_company_id, manager_id)
OVERRIDING SYSTEM VALUE VALUES
  ( 1, '선지농장',    '의성', '강정훈',       '계약중', 1, 1),
  ( 2, '덕원농장',    '김해', '장재용',       '계약중', 1, 1),
  ( 3, '이레농장',    '군위', '이정준',       '계약중', 1, 1),
  ( 4, '금산농장',    '구미', '배인호',       '계약중', 1, 2),
  ( 5, '대성농장',    '군위', '김선순',       '계약중', 1, 3),
  ( 6, '강변축산',    '의성', '김종년',       '계약중', 1, 3),
  ( 7, '광림축산',    '의성', '변상화',       '계약중', 1, 3),
  ( 8, '아린팜스',    '경주', '권준혁',       '계약중', 2, 4),
  ( 9, '울주아린팜스','웅촌', '권준혁',       '계약중', 2, 4),
  (10, '검단축산',    '웅촌', '김건수,신혜진','계약중', 2, 4),
  (11, '진호양돈',    '합천', '윤진호',       '계약중', 3, 5),
  (12, '거목농장',    '김해', '이태형',       '계약중', 3, 5),
  (13, '희숙농장',    '양산', '이태형',       '계약중', 3, 5),
  (14, '서광농장',    '양산', '김대환',       '계약중', 3, 5),
  (15, '이금농장',    '양산', '이태형(임대)', '계약중', 3, 5),
  (16, '화제축산',    '양산', '김정대',       '계약중', 3, 5),
  (17, '대동2농장',   '고령', '백운혜',       '계약중', 4, 6);

-- 농장ID 시퀀스 리셋 (GENERATED ALWAYS identity)
SELECT setval(pg_get_serial_sequence('list_farms', '농장ID'), 17);
