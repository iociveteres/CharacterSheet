DROP FUNCTION IF EXISTS can_view_character_sheet(INT, INT);
DROP FUNCTION IF EXISTS can_edit_character_sheet(INT, INT);
DROP FUNCTION IF EXISTS can_view_collection(INT, INT);
DROP TABLE IF EXISTS encounter_participants, initiative_groups, encounters, character_sheets, bestiary_subscriptions, bestiary_collections, character_sheet_folders, room_members, rooms CASCADE;
DROP TYPE IF EXISTS collection_visibility;
DROP TYPE IF EXISTS sheet_kind;
DROP TYPE IF EXISTS sheet_visibility;
DROP TYPE IF EXISTS room_role;
