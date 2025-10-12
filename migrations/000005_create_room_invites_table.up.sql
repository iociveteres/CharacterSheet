BEGIN;

CREATE TABLE room_invites (
    room_id INT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    token UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    expires_at TIMESTAMPTZ,                 -- NULL = never expires
    max_uses INT,                           -- NULL = unlimited
    uses INT NOT NULL DEFAULT 0,            -- how many times used so far

    CONSTRAINT chk_uses_nonneg CHECK (uses >= 0),
    CONSTRAINT chk_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
    CONSTRAINT chk_uses_le_max CHECK (max_uses IS NULL OR uses <= max_uses)
);

CREATE OR REPLACE FUNCTION redeem_and_add_member(
  p_token   UUID,
  p_user_id INT,
  p_role    room_role DEFAULT 'player'
)
RETURNS TABLE(rid INT, created BOOLEAN)
AS $$
DECLARE
  v_room_id   INT;
  v_expires_at TIMESTAMPTZ;
  v_uses      INT;
  v_max_uses  INT;
  v_created   BOOLEAN;
  v_rows      INT;
BEGIN
  -- Lock invite row and populate locals
  SELECT ri.room_id, ri.expires_at, ri.uses, ri.max_uses
  INTO v_room_id, v_expires_at, v_uses, v_max_uses
  FROM room_invites ri
  WHERE ri.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- invalid token
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
    RETURN; -- expired
  END IF;

  IF v_max_uses IS NOT NULL AND v_uses >= v_max_uses THEN
    RETURN; -- maxed out
  END IF;

  -- Try insert; skip if already member
  INSERT INTO room_members (room_id, user_id, role)
  VALUES (v_room_id, p_user_id, p_role)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    v_created := FALSE;
    RETURN QUERY SELECT v_room_id, v_created;
  END IF;

  -- Increment uses since new member added
  UPDATE room_invites ri
  SET uses = ri.uses + 1
  WHERE ri.token = p_token;

  v_created := TRUE;
  RETURN QUERY SELECT v_room_id, v_created;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMIT;
