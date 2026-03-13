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
  CONSTRAINT livestock_events_batch_id_fkey           FOREIGN KEY (batch_id) REFERENCES livestock_batches(batch_id) ON DELETE CASCADE,
  CONSTRAINT livestock_events_batch_id_event_date_key UNIQUE (batch_id, event_date)
);
