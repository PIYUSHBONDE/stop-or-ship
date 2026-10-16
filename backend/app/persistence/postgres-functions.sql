-- Fixed scalar JSON compatibility. Never accepts executable SQL from evidence.
CREATE OR REPLACE FUNCTION json_extract(document TEXT, path TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT SET search_path = pg_catalog
AS $$ SELECT document::jsonb #>> string_to_array(substring(path from 3), '.') $$;

CREATE OR REPLACE FUNCTION json_set(document TEXT, path TEXT, value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE WHEN document IS NULL OR path IS NULL THEN NULL ELSE
jsonb_set(document::jsonb, string_to_array(substring(path from 3), '.'),
COALESCE(to_jsonb(value), 'null'::jsonb), true)::text END $$;
