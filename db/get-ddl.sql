-- 테이블 컬럼 DDL 추출
SELECT
  'CREATE TABLE ' || table_schema || '.' || table_name || ' (' || chr(10) ||
  string_agg(
    '  ' || column_name || ' ' ||
    data_type ||
    CASE
      WHEN character_maximum_length IS NOT NULL
        THEN '(' || character_maximum_length || ')'
      WHEN numeric_precision IS NOT NULL AND data_type IN ('numeric','decimal')
        THEN '(' || numeric_precision || ',' || numeric_scale || ')'
      ELSE ''
    END ||
    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
    CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
    ',' || chr(10)
    ORDER BY ordinal_position
  ) || chr(10) || ');'
  AS ddl
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
GROUP BY table_schema, table_name
ORDER BY table_schema, table_name;


-- constraints (PK, FK, UNIQUE 등)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, contype;
