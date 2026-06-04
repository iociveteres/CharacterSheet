BEGIN;

CREATE OR REPLACE FUNCTION stringify_entry_values(entry jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(entry, '{}'::jsonb)
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'bonus') = 'number'
                THEN jsonb_build_object('bonus', (COALESCE(entry, '{}'::jsonb) ->> 'bonus'))
                ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'unnaturalBonus') = 'number'
                THEN jsonb_build_object('unnaturalBonus', (COALESCE(entry, '{}'::jsonb) ->> 'unnaturalBonus'))
                ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'rollBonus') = 'number'
                THEN jsonb_build_object('rollBonus', (COALESCE(entry, '{}'::jsonb) ->> 'rollBonus'))
                ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'cap') = 'number'
                THEN jsonb_build_object('cap', (COALESCE(entry, '{}'::jsonb) ->> 'cap'))
                ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'skillBonus') = 'number'
                THEN jsonb_build_object('skillBonus', (COALESCE(entry, '{}'::jsonb) ->> 'skillBonus'))
                ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(COALESCE(entry, '{}'::jsonb) -> 'ablativeWounds') = 'number'
                THEN jsonb_build_object('ablativeWounds', (COALESCE(entry, '{}'::jsonb) ->> 'ablativeWounds'))
                ELSE '{}'::jsonb END;
$$;

CREATE OR REPLACE FUNCTION stringify_entries_items(items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_object_agg(k, stringify_entry_values(v))
            FROM jsonb_each(COALESCE(items, '{}'::jsonb)) AS t(k, v)
        ),
        COALESCE(items, '{}'::jsonb)
    );
$$;

CREATE OR REPLACE FUNCTION stringify_condition_entries(cond_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_object_agg(
                ck,
                COALESCE(cv, '{}'::jsonb)
                || jsonb_build_object(
                    'entries',
                    COALESCE(cv->'entries', '{}'::jsonb)
                    || jsonb_build_object(
                        'items',
                        stringify_entries_items(COALESCE(cv #> '{entries,items}', '{}'::jsonb))
                    )
                )
            )
            FROM jsonb_each(COALESCE(cond_items, '{}'::jsonb)) AS t(ck, cv)
        ),
        COALESCE(cond_items, '{}'::jsonb)
    );
$$;

CREATE OR REPLACE FUNCTION stringify_item_entries(item_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_object_agg(
                ik,
                COALESCE(iv, '{}'::jsonb)
                || jsonb_build_object(
                    'entries',
                    COALESCE(iv->'entries', '{}'::jsonb)
                    || jsonb_build_object(
                        'items',
                        stringify_entries_items(COALESCE(iv #> '{entries,items}', '{}'::jsonb))
                    )
                )
            )
            FROM jsonb_each(COALESCE(item_items, '{}'::jsonb)) AS t(ik, iv)
        ),
        COALESCE(item_items, '{}'::jsonb)
    );
$$;

WITH src AS (
    SELECT
        id,
        COALESCE(content, '{}'::jsonb) AS c
    FROM character_sheets
)
UPDATE character_sheets cs
SET content =
    jsonb_set(
        src.c,
        '{conditions,list,items}',
        stringify_condition_entries(COALESCE(src.c #> '{conditions,list,items}', '{}'::jsonb))
    )
    || jsonb_build_object(
        'gear',
        COALESCE(src.c->'gear', '{}'::jsonb)
        || jsonb_build_object(
            'list',
            COALESCE(src.c->'gear'->'list', '{}'::jsonb)
            || jsonb_build_object(
                'items',
                stringify_item_entries(COALESCE(src.c #> '{gear,list,items}', '{}'::jsonb))
            )
        )
    )
    || jsonb_build_object(
        'cybernetics',
        COALESCE(src.c->'cybernetics', '{}'::jsonb)
        || jsonb_build_object(
            'list',
            COALESCE(src.c->'cybernetics'->'list', '{}'::jsonb)
            || jsonb_build_object(
                'items',
                stringify_item_entries(COALESCE(src.c #> '{cybernetics,list,items}', '{}'::jsonb))
            )
        )
    )
FROM src
WHERE cs.id = src.id;

DROP FUNCTION stringify_entry_values(jsonb);
DROP FUNCTION stringify_entries_items(jsonb);
DROP FUNCTION stringify_condition_entries(jsonb);
DROP FUNCTION stringify_item_entries(jsonb);

COMMIT;