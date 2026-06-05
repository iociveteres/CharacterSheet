BEGIN;

UPDATE character_sheets
SET content = jsonb_set(
    content - 'initiative',
    '{initiative}',
    to_jsonb(COALESCE(content->'initiative'->>'dice', 'd10'))
)
WHERE jsonb_typeof(content->'initiative') = 'object';

END;