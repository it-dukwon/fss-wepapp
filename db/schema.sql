-- ============================================================
-- 덕원농장 관리 시스템 - 전체 스키마 (DB 실제 기준)
-- ============================================================


-- ────────────────────────────────────────
-- 1. 농장 목록
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.list_farms (
  "농장ID"    BIGINT NOT NULL,
  "농장명"    CHARACTER VARYING(255),
  "지역"      CHARACTER VARYING(255),
  "뱃지"      CHARACTER VARYING(255),
  "농장주ID"  INTEGER,
  "농장주"    CHARACTER VARYING(255),
  "사료회사"  CHARACTER VARYING(255),
  "관리자ID"  INTEGER,
  "관리자"    CHARACTER VARYING(255),
  "계약상태"  CHARACTER VARYING(255),
  "계약시작일" DATE,
  "계약종료일" DATE,
  CONSTRAINT list_farms_pkey PRIMARY KEY ("농장ID")
);


-- ────────────────────────────────────────
-- 1-2. 사료회사
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feed_companies (
  id           SERIAL PRIMARY KEY,
  company_name CHARACTER VARYING(100) NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────
-- 1-3. 관리자 (사료회사 소속)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.managers (
  id               SERIAL PRIMARY KEY,
  manager_name     CHARACTER VARYING(100) NOT NULL,
  feed_company_id  INTEGER REFERENCES public.feed_companies(id) ON DELETE SET NULL,
  phone            CHARACTER VARYING(50),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- list_farms에 FK 컬럼 추가 (기존 텍스트 컬럼은 하위 호환용으로 유지)
ALTER TABLE public.list_farms ADD COLUMN IF NOT EXISTS feed_company_id INTEGER REFERENCES public.feed_companies(id) ON DELETE SET NULL;
ALTER TABLE public.list_farms ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES public.managers(id) ON DELETE SET NULL;

-- ────────────────────────────────────────
-- 2. 게시판
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_posts (
  id         BIGINT NOT NULL DEFAULT nextval('board_posts_id_seq'::regclass),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  author_upn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT board_posts_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_board_posts_created_at ON board_posts(created_at DESC);


-- ────────────────────────────────────────
-- 3. 앱 설정 (key-value)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본값: 매주 월요일 09:00 KST 발송
INSERT INTO public.app_settings (key, value)
VALUES ('email_mortality_schedule', '{"enabled":true,"dayOfWeek":1,"hour":9,"minute":0}')
ON CONFLICT (key) DO NOTHING;


-- ────────────────────────────────────────
-- 4. 사육두수 - 뱃지 (livestock_batches)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.livestock_batches (
  batch_id          INTEGER NOT NULL DEFAULT nextval('livestock_batches_batch_id_seq'::regclass),
  badge_name        CHARACTER VARYING(100) NOT NULL,
  farm_id           INTEGER,
  manager           CHARACTER VARYING(100),
  stock_in_date     DATE,
  stock_in_count    INTEGER NOT NULL DEFAULT 0,
  prev_month_count  INTEGER NOT NULL DEFAULT 0,
  status            CHARACTER VARYING(20) NOT NULL DEFAULT 'active',  -- active | completed
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT livestock_batches_pkey PRIMARY KEY (batch_id)
);


-- ────────────────────────────────────────
-- 4-2. 이메일 수신자 (email_recipients)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_recipients (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(100),
  alert_type  VARCHAR(50)  NOT NULL DEFAULT 'mortality_report',
  enabled     BOOLEAN      NOT NULL DEFAULT true,
  note        TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_recipients_alert_type ON email_recipients(alert_type);


-- ────────────────────────────────────────
-- 5. 사육두수 - 일별 이벤트 (livestock_events)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.livestock_events (
  event_id    INTEGER NOT NULL DEFAULT nextval('livestock_events_event_id_seq'::regclass),
  batch_id    INTEGER NOT NULL,
  event_date  DATE NOT NULL,
  transfer_in INTEGER NOT NULL DEFAULT 0,
  deaths      INTEGER NOT NULL DEFAULT 0,
  culled      INTEGER NOT NULL DEFAULT 0,
  shipped     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT livestock_events_pkey                    PRIMARY KEY (event_id),
  CONSTRAINT livestock_events_batch_id_fkey           FOREIGN KEY (batch_id) REFERENCES livestock_batches(batch_id) ON DELETE CASCADE
);


-- ────────────────────────────────────────
-- 6. 관리자 (admin_users)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_users (
  id         SERIAL PRIMARY KEY,
  upn        VARCHAR(255) NOT NULL,  -- Azure AD UPN (이메일)
  name       VARCHAR(255),           -- 표시 이름 (선택)
  enabled    BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_users_upn_key UNIQUE (upn)
);

CREATE INDEX IF NOT EXISTS admin_users_upn_idx ON public.admin_users (lower(upn));

-- 초기 관리자 계정
-- INSERT INTO public.admin_users (upn, name) VALUES
--   ('it.dukwon@gmail.com',                       '덕원(외부)'),
--   ('gm.seo@itdukwongmail.onmicrosoft.com',       '서GM'),
--   ('user01@itdukwongmail.onmicrosoft.com',       'User01')
-- ON CONFLICT (upn) DO NOTHING;

-- SELECT * from PUBLIC.admin_users;


-- ────────────────────────────────────────
-- 7. 사용자 활동 로그 (user_activity_logs)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_upn      VARCHAR(255),                         -- Azure AD UPN (이메일)
  user_name     VARCHAR(255),                         -- 사용자 표시 이름
  action        VARCHAR(20)  NOT NULL,                -- INSERT | UPDATE | DELETE | START | STOP
  resource_type VARCHAR(50)  NOT NULL,                -- farm | feed_company | manager | livestock_batch | livestock_event | board_post | db_server
  resource_id   VARCHAR(100),                         -- 대상 레코드 PK
  summary       TEXT                                  -- 사람이 읽기 좋은 요약
);

CREATE INDEX IF NOT EXISTS user_activity_logs_created_at_idx ON public.user_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_logs_user_upn_idx   ON public.user_activity_logs (user_upn);
CREATE INDEX IF NOT EXISTS user_activity_logs_resource_idx   ON public.user_activity_logs (resource_type, resource_id);
