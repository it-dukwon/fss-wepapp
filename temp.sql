-- temp.sql
-- 실행 후 제거하거나 별도 보관. 이미 적용된 항목은 주석 처리.
-- 최근 변경순 (위가 최신)

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
