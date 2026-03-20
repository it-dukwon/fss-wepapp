-- Migration 001: livestock_events 날짜+뱃지 UNIQUE 제약 제거
-- 이벤트를 로그 방식으로 운영 (같은 날 여러 건 허용, 통계는 SUM으로 집계)
-- 실행 시점: 2026-03-20

ALTER TABLE public.livestock_events
  DROP CONSTRAINT IF EXISTS livestock_events_batch_id_event_date_key;
