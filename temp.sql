-- temp.sql
-- 실행 후 제거하거나 별도 보관. 이미 적용된 항목은 주석 처리.
-- 최근 변경순 (위가 최신)

-- [2026-03-21] 파스(사이클) 관리 테이블 신설
CREATE TABLE IF NOT EXISTS livestock_passes (
  pass_id     SERIAL PRIMARY KEY,
  batch_id    INT NOT NULL REFERENCES livestock_batches(batch_id),
  pass_name   VARCHAR(100) NOT NULL,   -- 예: 덕원농장A-26-1
  pass_no     SMALLINT NOT NULL,       -- 1, 2, 3 ...
  year_yy     SMALLINT NOT NULL,       -- 연도 끝 2자리 (26)
  start_count INT NOT NULL DEFAULT 0,  -- 파스 시작 두수 (이전 파스 잔여)
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  started_at  DATE,
  ended_at    DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS pass_id INT REFERENCES livestock_passes(pass_id);

-- [2026-03-21] 공제 이벤트 타입 추가
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS deducted INT DEFAULT 0;

-- [2026-03-21] 폐사율 벤치마크 기본값 (월 0.5%)
INSERT INTO app_settings (key, value)
VALUES ('mortality_benchmark_monthly_pct', '0.5')
ON CONFLICT (key) DO NOTHING;

-- [2026-03-21] 농장 은행/계좌 정보
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS bank_name       VARCHAR(50);
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS account_number  VARCHAR(50);
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS account_holder  VARCHAR(50);

-- [2026-03-21] 농장 보험 정보 / 계약상태 선택값 변경
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(10);
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS insurance_expire DATE;

-- [이전] 농장주 이메일
ALTER TABLE list_farms ADD COLUMN IF NOT EXISTS owner_email VARCHAR(200);

-- [이전] 사육 이벤트 타입 분리 (입식/도폐사/출하)
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS stock_weight    NUMERIC(10,2);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS event_type      VARCHAR(20);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS death_type      VARCHAR(10);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS ship_weight     NUMERIC(10,2);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS distributor     VARCHAR(100);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS slaughterhouse  VARCHAR(100);
ALTER TABLE livestock_events ADD COLUMN IF NOT EXISTS meat_processor  VARCHAR(100);
