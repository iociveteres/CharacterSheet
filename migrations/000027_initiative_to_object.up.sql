BEGIN;

UPDATE character_sheets
SET content = jsonb_set(
    content - 'initiative',
    '{initiative}',
    jsonb_build_object(
        'dice',     COALESCE(content->>'initiative', 'd10'),
        'wsBonus',  false,
        'bsBonus',  false,
        'sBonus',   false,
        'tBonus',   false,
        'aBonus',   true,
        'iBonus',   false,
        'pBonus',   false,
        'wBonus',   false,
        'fBonus',   false,
        'corBonus', false,
        'infBonus', false,
        'flatBonus', 0
    )
)
WHERE jsonb_typeof(content->'initiative') = 'string';

COMMIT;