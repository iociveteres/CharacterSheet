BEGIN;

DROP FUNCTION IF EXISTS redeem_and_add_member(uuid,integer,room_role);

DROP TABLE IF EXISTS room_invites;

COMMIT;