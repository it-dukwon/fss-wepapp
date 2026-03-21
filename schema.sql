-- schema.sql
-- 전체 테이블 형상 (최신 기준)
-- Last updated: 2026-03-21

-- ─────────────────────────────────────────────────────────────
-- 사료회사
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feed_companies (
  id           SERIAL PRIMARY KEY,
  company_name VARCHAR(100) NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 관리자
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managers (
  id              SERIAL PRIMARY KEY,
  manager_name    VARCHAR(100) NOT NULL,
  feed_company_id INTEGER REFERENCES feed_companies(id) ON DELETE SET NULL,
  phone           VARCHAR(50),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 농장
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS list_farms (
  "농장ID"         BIGSERIAL PRIMARY KEY,
  "농장명"         VARCHAR(255),
  "지역"           VARCHAR(255),
  "농장주"         VARCHAR(255),
  "계약상태"       VARCHAR(50),
  "계약시작일"     DATE,
  "계약종료일"     DATE,
  owner_email      VARCHAR(200),
  feed_company_id  INTEGER REFERENCES feed_companies(id) ON DELETE SET NULL,
  manager_id       INTEGER REFERENCES managers(id) ON DELETE SET NULL,
  insurance_status VARCHAR(10),   -- '가입' | '미가입'
  insurance_expire DATE,
  bank_name        VARCHAR(50),
  account_number   VARCHAR(50),
  account_holder   VARCHAR(50)
);

-- ─────────────────────────────────────────────────────────────
-- 사육 배치 (뱃지)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS livestock_batches (
  batch_id        SERIAL PRIMARY KEY,
  badge_name      VARCHAR(100) NOT NULL,
  farm_id         INTEGER REFERENCES list_farms("농장ID") ON DELETE SET NULL,
  manager         VARCHAR(100),
  stock_in_date   DATE,
  stock_in_count  INTEGER DEFAULT 0,
  prev_month_count INTEGER DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'active',  -- 'active' | 'completed'
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 사육 이벤트
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS livestock_events (
  event_id      SERIAL PRIMARY KEY,
  batch_id      INTEGER NOT NULL REFERENCES livestock_batches(batch_id) ON DELETE CASCADE,
  event_date    DATE NOT NULL,
  event_type    VARCHAR(20),      -- 'stock_in' | 'death' | 'shipping'
  transfer_in   INTEGER DEFAULT 0,
  deaths        INTEGER DEFAULT 0,
  culled        INTEGER DEFAULT 0,
  shipped       INTEGER DEFAULT 0,
  stock_weight  NUMERIC(10,2),    -- 입식 총체중 (kg)
  ship_weight   NUMERIC(10,2),    -- 출하 총체중 (kg)
  death_type    VARCHAR(10),      -- '폐사' | '도태' | '확인불가'
  distributor   VARCHAR(100),
  slaughterhouse VARCHAR(100),
  meat_processor VARCHAR(100),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 위탁정산서
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consignment_settlements (
  id                  SERIAL PRIMARY KEY,
  batch_id            INT UNIQUE REFERENCES livestock_batches(batch_id),
  farm_account        VARCHAR(200),
  initial_stock_weight NUMERIC(10,2) DEFAULT 0,
  claim_count         INT DEFAULT 0,
  std_mortality_rate  NUMERIC(6,4) DEFAULT 0.03,
  grade_1plus         INT DEFAULT 0,
  grade_1             INT DEFAULT 0,
  grade_2             INT DEFAULT 0,
  grade_out_spec      INT DEFAULT 0,
  grade_out_other     INT DEFAULT 0,
  grade_penalty       NUMERIC(15,0) DEFAULT 0,
  feed_piglet         NUMERIC(10,2) DEFAULT 0,
  feed_grow           NUMERIC(10,2) DEFAULT 0,
  feed_cost_total     NUMERIC(15,0) DEFAULT 0,
  base_fee            NUMERIC(15,0) DEFAULT 0,
  incentive_growth    NUMERIC(15,0) DEFAULT 0,
  incentive_feed      NUMERIC(15,0) DEFAULT 0,
  penalty_grade       NUMERIC(15,0) DEFAULT 0,
  prepayment          NUMERIC(15,0) DEFAULT 0,
  payment_note        VARCHAR(500),
  revenue             NUMERIC(15,0) DEFAULT 0,
  piglet_cost         NUMERIC(15,0) DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 게시판
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_posts (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  author_upn TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_board_posts_created_at ON board_posts(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 한줄공지
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notice_banners (
  id           SERIAL PRIMARY KEY,
  message      TEXT NOT NULL,
  display_from TIMESTAMPTZ NOT NULL,
  display_to   TIMESTAMPTZ NOT NULL,
  created_by   VARCHAR(255),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notice_banners_period ON notice_banners(display_from, display_to);

-- ─────────────────────────────────────────────────────────────
-- 앱 설정
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 이메일 수신자
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_recipients (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  name       VARCHAR(100),
  alert_type VARCHAR(50) DEFAULT 'mortality_report',
  enabled    BOOLEAN DEFAULT true,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_recipients_alert_type ON email_recipients(alert_type);

-- ─────────────────────────────────────────────────────────────
-- 관리자 계정
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id         SERIAL PRIMARY KEY,
  upn        VARCHAR(255) NOT NULL UNIQUE,
  name       VARCHAR(255),
  enabled    BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_users_upn_idx ON admin_users(lower(upn));

-- ─────────────────────────────────────────────────────────────
-- 사용자 활동 로그
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  user_upn      VARCHAR(255),
  user_name     VARCHAR(255),
  action        VARCHAR(20) NOT NULL,   -- INSERT | UPDATE | DELETE | VIEW
  resource_type VARCHAR(50) NOT NULL,
  resource_id   VARCHAR(100),
  summary       TEXT
);
CREATE INDEX IF NOT EXISTS user_activity_logs_created_at_idx ON user_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_logs_user_upn_idx   ON user_activity_logs(user_upn);
CREATE INDEX IF NOT EXISTS user_activity_logs_resource_idx   ON user_activity_logs(resource_type, resource_id);
