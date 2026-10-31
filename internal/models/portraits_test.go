package models

import (
	"bytes"
	"errors"
	"testing"
)

func (r *encounterRoom) portraits() *PortraitModel {
	return &PortraitModel{DB: r.pool}
}

// putPortrait makes `data` the portrait of the sheet on behalf of `user`.
func (r *encounterRoom) putPortrait(user, sheetID int, data string) string {
	r.t.Helper()
	hash, err := r.portraits().Put(r.ctx, user, sheetID, "image/webp", []byte(data))
	if err != nil {
		r.t.Fatal(err)
	}
	return hash
}

// portraitOf is the hash of the sheet's portrait, "" without one.
func (r *encounterRoom) portraitOf(sheetID int) string {
	r.t.Helper()
	var hash string
	r.pool.QueryRow(r.ctx, `SELECT hash FROM sheet_portraits WHERE sheet_id = $1`, sheetID).Scan(&hash)
	return hash
}

func (r *encounterRoom) images() int {
	r.t.Helper()
	return r.count(`SELECT count(*) FROM portrait_images`)
}

func TestPortraitOfRoomSheetRights(t *testing.T) {
	r := newEncounterRoom(t)
	viewer := r.insert(`INSERT INTO users (name, email, hashed_password, created) VALUES ('viewer', 'viewer@example.com', '', now())`)
	r.exec(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'player')`, r.room, viewer)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	p := r.portraits()

	for _, u := range []int{r.player, r.gm, r.moderator} {
		if _, err := p.Put(r.ctx, u, sheet, "image/webp", []byte{byte(u)}); err != nil {
			t.Errorf("user %d may edit the sheet: %v", u, err)
		}
	}
	hash := r.putPortrait(r.player, sheet, "Ulrich")

	if _, err := p.Put(r.ctx, viewer, sheet, "image/webp", []byte("viewer's")); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a viewer replaced the portrait: %v", err)
	}
	if err := p.Delete(r.ctx, viewer, sheet); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a viewer deleted the portrait: %v", err)
	}
	if got, err := p.Get(r.ctx, viewer, hash); err != nil || got.Mime != "image/webp" || string(got.Data) != "Ulrich" {
		t.Errorf("a viewer got %+v, %v", got, err)
	}

	// A member of another room neither sees nor changes it, and learns no
	// more than of an image that does not exist.
	if _, err := p.Get(r.ctx, r.outsider, hash); !errors.Is(err, ErrNoRecord) {
		t.Errorf("an outsider got the portrait: %v", err)
	}
	if _, err := p.Put(r.ctx, r.outsider, sheet, "image/webp", []byte("outsider's")); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("an outsider replaced the portrait: %v", err)
	}
	if _, err := p.Get(r.ctx, r.player, "0123456789abcdef"); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a missing image: %v", err)
	}
	if _, err := p.Put(r.ctx, r.player, sheet+1000, "image/webp", []byte("x")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a missing sheet: %v", err)
	}

	r.exec(`UPDATE character_sheets SET sheet_visibility = 'everyone_can_edit' WHERE id = $1`, sheet)
	if _, err := p.Put(r.ctx, viewer, sheet, "image/jpeg", []byte("viewer's")); err != nil {
		t.Errorf("everyone_can_edit: %v", err)
	}
	if err := p.Delete(r.ctx, viewer, sheet); err != nil || r.portraitOf(sheet) != "" {
		t.Errorf("everyone_can_edit: delete %v, left %q", err, r.portraitOf(sheet))
	}
	r.exec(`UPDATE character_sheets SET sheet_visibility = 'hide_from_players' WHERE id = $1`, sheet)
	hash = r.putPortrait(r.player, sheet, "Ulrich")
	if _, err := p.Get(r.ctx, viewer, hash); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a hidden sheet's portrait: %v", err)
	}
}

func TestPortraitOfCreatureRights(t *testing.T) {
	r := newEncounterRoom(t)
	c := r.collection(r.player, "Orks")
	creature := r.creature(r.player, c, "Ork Boy")
	p := r.portraits()

	hash := r.putPortrait(r.player, creature, "Ork Boy")
	if _, err := p.Get(r.ctx, r.gm, hash); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the portrait of a private creature: %v", err)
	}
	if _, err := p.Put(r.ctx, r.gm, creature, "image/webp", []byte("gm's")); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the gamemaster of the room replaced a player's creature's portrait: %v", err)
	}

	// A shared collection is seen by anyone, edited by its owner only.
	r.exec(`UPDATE bestiary_collections SET visibility = 'public' WHERE id = $1`, c)
	if got, err := p.Get(r.ctx, r.outsider, hash); err != nil || string(got.Data) != "Ork Boy" {
		t.Errorf("the portrait of a public creature: %+v, %v", got, err)
	}
	if _, err := p.Put(r.ctx, r.outsider, creature, "image/webp", []byte("outsider's")); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a viewer of a shared collection replaced the portrait: %v", err)
	}
	if err := p.Delete(r.ctx, r.outsider, creature); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a viewer of a shared collection deleted the portrait: %v", err)
	}
	if err := p.Delete(r.ctx, r.player, creature); err != nil || r.portraitOf(creature) != "" {
		t.Errorf("the owner's delete: %v, left %q", err, r.portraitOf(creature))
	}
}

func TestPortraitOfNpcRights(t *testing.T) {
	r := newEncounterRoom(t)
	creature := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")
	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), creature, 1))
	npc := s.Participants[0].SheetID

	if _, err := r.portraits().Put(r.ctx, r.player, npc, "image/webp", []byte("player's")); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player gave an NPC a portrait: %v", err)
	}
	hash := r.putPortrait(r.gm, npc, "Ork Boy")
	if _, err := r.portraits().Get(r.ctx, r.player, hash); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player got an NPC's portrait: %v", err)
	}
}

func TestPortraitIsWebpOrJpeg(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	for name, tt := range map[string]struct {
		mime string
		data []byte
	}{
		"png":     {"image/png", []byte("x")},
		"empty":   {"image/webp", nil},
		"too big": {"image/jpeg", bytes.Repeat([]byte("x"), PortraitMaxBytes+1)},
		"no mime": {"", []byte("x")},
		"html":    {"text/html", []byte("<script>")},
	} {
		if _, err := r.portraits().Put(r.ctx, r.player, sheet, tt.mime, tt.data); !errors.Is(err, ErrInvalidPortrait) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := r.portraits().Put(r.ctx, r.player, sheet, "image/jpeg", bytes.Repeat([]byte("x"), PortraitMaxBytes)); err != nil {
		t.Errorf("an image of the largest size: %v", err)
	}
}

func TestCopyCarriesPortrait(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.collection(r.gm, "Orks")
	creature := r.creature(r.gm, orks, "Ork Boy")
	hash := r.putPortrait(r.gm, creature, "Ork Boy")

	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), creature, 3))
	for _, p := range s.Participants {
		if got := r.portraitOf(p.SheetID); got != hash {
			t.Errorf("NPC %d has portrait %q, want %q", p.SheetID, got, hash)
		}
	}
	npc := s.Participants[0].SheetID

	copied, err := b.CopyCreature(r.ctx, r.gm, creature, into(orks))
	if err != nil {
		t.Fatal(err)
	}
	variant, _, err := b.AddVariant(r.ctx, r.gm, npc, "Ork Nob")
	if err != nil {
		t.Fatal(err)
	}
	sheet := r.sheet(r.player, r.room, "Ulrich")
	sheetHash := r.putPortrait(r.player, sheet, "Ulrich")
	saved, err := b.Save(r.ctx, r.gm, sheet, into(orks))
	if err != nil {
		t.Fatal(err)
	}
	for name, got := range map[string][2]string{
		"copy":    {r.portraitOf(copied.ID), hash},
		"variant": {r.portraitOf(variant.ID), hash},
		"saved":   {r.portraitOf(saved.ID), sheetHash},
	} {
		if got[0] != got[1] {
			t.Errorf("%s has portrait %q, want %q", name, got[0], got[1])
		}
	}
	if n := r.images(); n != 2 {
		t.Errorf("%d images for two portraits", n)
	}

	// A sheet without a portrait makes a copy without one.
	plain := r.creature(r.gm, orks, "Grot")
	c, err := b.CopyCreature(r.ctx, r.gm, plain, into(orks))
	if err != nil {
		t.Fatal(err)
	}
	if got := r.portraitOf(c.ID); got != "" {
		t.Errorf("a copy of a creature without a portrait has %q", got)
	}
}

func TestSamePortraitIsStoredOnce(t *testing.T) {
	r := newEncounterRoom(t)
	a, b := r.sheet(r.player, r.room, "Ulrich"), r.sheet(r.gm, r.room, "Gerta")
	ha, hb := r.putPortrait(r.player, a, "same"), r.putPortrait(r.gm, b, "same")
	if ha != hb || len(ha) != 16 {
		t.Errorf("hashes %q and %q", ha, hb)
	}
	if n := r.images(); n != 1 {
		t.Errorf("%d images of one picture", n)
	}
	// Putting the same image again changes nothing.
	if h := r.putPortrait(r.player, a, "same"); h != ha || r.images() != 1 {
		t.Errorf("hash %q, %d images", h, r.images())
	}
}

func TestPortraitGoesWithItsLastLink(t *testing.T) {
	r := newEncounterRoom(t)
	exists := func(hash string) bool {
		return r.count(`SELECT count(*) FROM portrait_images WHERE hash = $1`, hash) == 1
	}

	t.Run("delete and replace", func(t *testing.T) {
		a, b := r.sheet(r.player, r.room, "Ulrich"), r.sheet(r.player, r.room, "Gerta")
		old := r.putPortrait(r.player, a, "delete and replace")
		r.putPortrait(r.player, b, "delete and replace")

		if err := r.portraits().Delete(r.ctx, r.player, a); err != nil {
			t.Fatal(err)
		}
		if !exists(old) {
			t.Fatal("the image went while a sheet links to it")
		}
		r.putPortrait(r.player, b, "another")
		if exists(old) {
			t.Error("the replaced image outlived its last link")
		}
		if err := r.portraits().Delete(r.ctx, r.player, b); err != nil {
			t.Fatal(err)
		}
		if r.images() != 0 {
			t.Errorf("%d images left without links", r.images())
		}
	})

	t.Run("sheet", func(t *testing.T) {
		sheet := r.sheet(r.player, r.room, "Ulrich")
		hash := r.putPortrait(r.player, sheet, "sheet")
		if _, err := r.sheets.Delete(r.ctx, r.player, sheet); err != nil {
			t.Fatal(err)
		}
		if exists(hash) {
			t.Error("the image outlived its sheet")
		}
	})

	t.Run("encounter", func(t *testing.T) {
		creature := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")
		creatureHash := r.putPortrait(r.gm, creature, "creature")
		s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), creature, 2))
		npcHash := r.putPortrait(r.gm, s.Participants[0].SheetID, "npc")

		if _, err := r.encounters.Delete(r.ctx, r.ref(s)); err != nil {
			t.Fatal(err)
		}
		if exists(npcHash) {
			t.Error("the image outlived its encounter")
		}
		if !exists(creatureHash) {
			t.Error("the creature's image went with the encounter of its copies")
		}
	})

	t.Run("collection", func(t *testing.T) {
		c := r.newCollection(r.player, "Mine")
		creature := r.creature(r.player, c.ID, "Grot")
		hash := r.putPortrait(r.player, creature, "collection")
		if _, err := r.bestiary().DeleteCollection(r.ctx, r.player, c.ID); err != nil {
			t.Fatal(err)
		}
		if exists(hash) {
			t.Error("the image outlived its collection")
		}
	})
}

func TestQuotaCountsPortraits(t *testing.T) {
	r := newEncounterRoom(t)
	c := r.collection(r.gm, "Orks")
	creature := r.creature(r.gm, c, "Ork Boy")
	used := func() int64 {
		t.Helper()
		n, err := r.sheets.QuotaUsed(r.ctx, r.gm)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := used()

	image := incompressible(30 << 10)
	r.putPortrait(r.gm, creature, image)
	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), creature, 1))
	npcs := used() - before
	// The creature and its copy share one image: it counts once.
	if npcs < 30<<10 || npcs > 30<<10+4096 {
		t.Errorf("a creature, its copy and their portrait take %d bytes", npcs)
	}

	// A character's portrait does not count, even when it is the same image.
	sheet := r.sheet(r.gm, r.room, "Gerta")
	afterCopy := used()
	r.putPortrait(r.gm, sheet, incompressible(30<<10))
	r.putPortrait(r.gm, sheet, image)
	if n := used(); n != afterCopy {
		t.Errorf("a character's portrait changed the quota from %d to %d", afterCopy, n)
	}

	// Past the quota, a new image of an NPC is rejected and nothing changes.
	r.exec(`INSERT INTO character_sheets (owner_id, collection_id, content)
        VALUES ($1, $2, jsonb_build_object('filler', $3::text))`, r.gm, c, incompressible(QuotaBytes-int(used())-1000))
	npc := s.Participants[0].SheetID
	_, err := r.portraits().Put(r.ctx, r.gm, npc, "image/webp", []byte(incompressible(2000)))
	var quota *QuotaError
	if !errors.As(err, &quota) || quota.Limit != QuotaBytes || quota.Adding < 2000 {
		t.Errorf("got %v, want a QuotaError", err)
	}
	if got := r.portraitOf(npc); got == "" || r.count(`SELECT count(*) FROM portrait_images WHERE octet_length(data) = 2000`) != 0 {
		t.Errorf("the rejected image was stored: portrait %q", got)
	}

	// An image the user already has adds nothing, and neither does a
	// character's portrait.
	if _, err := r.portraits().Put(r.ctx, r.gm, npc, "image/webp", []byte(image)); err != nil {
		t.Errorf("an image already counted: %v", err)
	}
	if _, err := r.portraits().Put(r.ctx, r.gm, sheet, "image/webp", []byte(incompressible(2000))); err != nil {
		t.Errorf("a character's portrait past the quota: %v", err)
	}
}

func TestPortraitIsChangeOfSheet(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	r.exec(`UPDATE character_sheets SET updated_at = now() - interval '1 day' WHERE id = $1`, sheet)
	changed := func() bool {
		t.Helper()
		n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1 AND updated_at > now() - interval '1 hour'`, sheet)
		r.exec(`UPDATE character_sheets SET updated_at = now() - interval '1 day' WHERE id = $1`, sheet)
		return n == 1
	}
	version := func() int {
		t.Helper()
		return r.count(`SELECT version FROM character_sheets WHERE id = $1`, sheet)
	}
	v := version()

	if err := r.portraits().Delete(r.ctx, r.player, sheet); err != nil || changed() {
		t.Errorf("deleting no portrait changed the sheet: %v", err)
	}
	r.putPortrait(r.player, sheet, "Ulrich")
	if !changed() {
		t.Error("a new portrait left updated_at")
	}
	if err := r.portraits().Delete(r.ctx, r.player, sheet); err != nil || !changed() {
		t.Errorf("deleting the portrait left updated_at: %v", err)
	}
	if version() != v {
		t.Errorf("version %d, was %d: a portrait is no content edit", version(), v)
	}
}

func TestSheetViewCarriesPortrait(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	view := func() *string {
		t.Helper()
		v, err := r.sheets.GetWithPermission(r.ctx, r.player, sheet)
		if err != nil {
			t.Fatal(err)
		}
		return v.CharacterSheet.Portrait
	}
	if got := view(); got != nil {
		t.Errorf("a sheet without a portrait has %q", *got)
	}
	hash := r.putPortrait(r.player, sheet, "Ulrich")
	if got := view(); got == nil || *got != hash {
		t.Errorf("portrait %v, want %q", got, hash)
	}
}
