package models

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
)

func (r *encounterRoom) bestiary() *BestiaryModel {
	return &BestiaryModel{DB: r.pool}
}

func (r *encounterRoom) newCollection(user int, name string) *BestiaryCollection {
	r.t.Helper()
	c, err := r.bestiary().CreateCollection(r.ctx, user, name)
	if err != nil {
		r.t.Fatal(err)
	}
	return c
}

func (r *encounterRoom) content(sheetID int) map[string]any {
	r.t.Helper()
	var raw []byte
	if err := r.pool.QueryRow(r.ctx, `SELECT content FROM character_sheets WHERE id = $1`, sheetID).Scan(&raw); err != nil {
		r.t.Fatal(err)
	}
	var c map[string]any
	if err := json.Unmarshal(raw, &c); err != nil {
		r.t.Fatal(err)
	}
	return c
}

func at(c map[string]any, keys ...string) any {
	var v any = c
	for _, k := range keys {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}

func names(creatures []Creature) []string {
	out := []string{}
	for _, c := range creatures {
		out = append(out, c.Name)
	}
	return out
}

func strp(s string) *string { return &s }

func TestCollections(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "  Orks ")
	cult := r.newCollection(r.gm, "Cult")
	r.newCollection(r.player, "Players'")
	r.creature(r.gm, orks.ID, "Ork Boy")

	if orks.Name != "Orks" || len(orks.Tags) != 0 {
		t.Errorf("created %+v", orks)
	}
	for _, name := range []string{"", "   ", string(make([]rune, maxCollectionName+1))} {
		if _, err := b.CreateCollection(r.ctx, r.gm, name); !errors.Is(err, ErrInvalidBestiaryRequest) {
			t.Errorf("name %q: %v", name, err)
		}
	}

	edited, err := b.UpdateCollection(r.ctx, r.gm, orks.ID, CollectionEdit{
		Description: strp("Greenskins of the hive"),
		Tags:        &[]string{" greenskins", "Greenskins", "", "hive"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if edited.Name != "Orks" || edited.Description != "Greenskins of the hive" || !slices.Equal(edited.Tags, []string{"greenskins", "hive"}) || edited.Creatures != 1 {
		t.Errorf("edited %+v", edited)
	}
	tooMany := make([]string, maxTags+1)
	for i := range tooMany {
		tooMany[i] = string(rune('a' + i))
	}
	for _, tags := range [][]string{tooMany, {string(make([]rune, maxTag+1))}} {
		if _, err := b.UpdateCollection(r.ctx, r.gm, orks.ID, CollectionEdit{Tags: &tags}); !errors.Is(err, ErrInvalidBestiaryRequest) {
			t.Errorf("%d tags: %v", len(tags), err)
		}
	}

	got, err := b.Get(r.ctx, r.gm)
	if err != nil {
		t.Fatal(err)
	}
	var list []string
	for _, c := range got.Collections {
		list = append(list, c.Name)
	}
	// The last changed first, and only the user's.
	if !slices.Equal(list, []string{"Orks", "Cult"}) {
		t.Errorf("collections %v", list)
	}
	if got.Quota.Limit != QuotaBytes || got.Quota.Used == 0 {
		t.Errorf("quota %+v", got.Quota)
	}
	if !slices.Equal(got.Tags.Collections, []string{"greenskins", "hive"}) {
		t.Errorf("collection tags %v", got.Tags.Collections)
	}

	for _, u := range []int{r.player, r.outsider} {
		if _, err := b.UpdateCollection(r.ctx, u, orks.ID, CollectionEdit{Name: strp("Mine")}); !errors.Is(err, ErrNoRecord) {
			t.Errorf("user %d renamed the collection: %v", u, err)
		}
		if _, err := b.DeleteCollection(r.ctx, u, orks.ID); !errors.Is(err, ErrNoRecord) {
			t.Errorf("user %d deleted the collection: %v", u, err)
		}
		if _, err := b.Export(r.ctx, u, orks.ID); !errors.Is(err, ErrNoRecord) {
			t.Errorf("user %d exported the collection: %v", u, err)
		}
	}
	if _, err := b.UpdateCollection(r.ctx, r.gm, 1_000_000, CollectionEdit{}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("missing collection: %v", err)
	}

	cultist := r.creature(r.gm, cult.ID, "Cultist")
	deleted, err := b.DeleteCollection(r.ctx, r.gm, cult.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The open pages of the user let go of them (webapp.collectionDelete).
	if !slices.Equal(deleted, []int{cultist}) {
		t.Errorf("deleted creatures %v, want %v", deleted, []int{cultist})
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE id = $1`, cult.ID); n != 0 {
		t.Error("the collection is still there")
	}
}

func TestCreatureSearch(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks, cult := r.newCollection(r.gm, "Orks"), r.newCollection(r.gm, "Cult")
	boy := r.creature(r.gm, orks.ID, "Ork Boy")
	r.creature(r.gm, orks.ID, "Gretchin")
	r.creature(r.gm, cult.ID, "Cultist 100%")
	r.creature(r.player, r.newCollection(r.player, "Mine").ID, "Ork Nob")
	r.exec(`UPDATE character_sheets SET tags = '{infantry}', content = jsonb_set(content, '{armour}', '{"woundsMax": "12"}') WHERE id = $1`, boy)

	tests := []struct {
		name   string
		filter CreatureFilter
		want   []string
	}{
		{"all of the user's", CreatureFilter{}, []string{"Cultist 100%", "Gretchin", "Ork Boy"}},
		{"a collection", CreatureFilter{CollectionID: &orks.ID}, []string{"Gretchin", "Ork Boy"}},
		{"a name", CreatureFilter{Query: "ork"}, []string{"Ork Boy"}},
		{"a percent sign", CreatureFilter{Query: "0%"}, []string{"Cultist 100%"}},
		{"an underscore matches itself", CreatureFilter{Query: "_"}, []string{}},
		{"a tag", CreatureFilter{Tag: "infantry"}, []string{"Ork Boy"}},
	}
	for _, tt := range tests {
		got, err := b.Creatures(r.ctx, r.gm, tt.filter)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(names(got), tt.want) {
			t.Errorf("%s: %v, want %v", tt.name, names(got), tt.want)
		}
	}

	got, _ := b.Creatures(r.ctx, r.gm, CreatureFilter{Tag: "infantry"})
	if c := got[0]; c.ID != boy || c.CollectionID != orks.ID || c.Kind != KindBlackCrusade || !slices.Equal(c.Tags, []string{"infantry"}) {
		t.Errorf("row %+v", c)
	}
	if _, err := b.Creatures(r.ctx, r.player, CreatureFilter{CollectionID: &orks.ID}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player listed the gamemaster's collection: %v", err)
	}
}

func TestEditCreature(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "Orks")
	boy := r.creature(r.gm, orks.ID, "Ork Boy")

	c, err := b.UpdateCreature(r.ctx, r.gm, boy, CreatureEdit{Name: strp(" Ork Nob "), Tags: &[]string{"elite"}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Name != "Ork Nob" || !slices.Equal(c.Tags, []string{"elite"}) || at(r.content(boy), "characterInfo", "characterName") != "Ork Nob" {
		t.Errorf("edited %+v", c)
	}
	// Only the tags: the name stays.
	if c, err = b.UpdateCreature(r.ctx, r.gm, boy, CreatureEdit{Tags: &[]string{}}); err != nil || c.Name != "Ork Nob" || len(c.Tags) != 0 {
		t.Errorf("tags cleared: %+v, %v", c, err)
	}
	if _, err := b.UpdateCreature(r.ctx, r.gm, boy, CreatureEdit{Name: strp("")}); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("empty name: %v", err)
	}

	for _, u := range []int{r.player, r.moderator, r.outsider} {
		if _, err := b.UpdateCreature(r.ctx, u, boy, CreatureEdit{Name: strp("Mine")}); !errors.Is(err, ErrNoRecord) {
			t.Errorf("user %d renamed the creature: %v", u, err)
		}
		if err := b.DeleteCreature(r.ctx, u, boy); !errors.Is(err, ErrNoRecord) {
			t.Errorf("user %d deleted the creature: %v", u, err)
		}
	}
	// A sheet of a room is no creature.
	character := r.sheet(r.gm, r.room, "Ulrich")
	if _, err := b.UpdateCreature(r.ctx, r.gm, character, CreatureEdit{Name: strp("Mine")}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a character renamed as a creature: %v", err)
	}

	if err := b.DeleteCreature(r.ctx, r.gm, boy); err != nil {
		t.Fatal(err)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1`, boy); n != 0 {
		t.Error("the creature is still there")
	}
}

func TestCopyAndMoveCreature(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks, cult := r.newCollection(r.gm, "Orks"), r.newCollection(r.gm, "Cult")
	theirs := r.newCollection(r.player, "Mine")
	boy := r.creature(r.gm, orks.ID, "Ork Boy")
	r.exec(`UPDATE character_sheets SET tags = '{infantry}' WHERE id = $1`, boy)

	copied, err := b.CopyCreature(r.ctx, r.gm, boy, into(cult.ID))
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID == boy || copied.CollectionID != cult.ID || copied.Name != "Ork Boy" || !slices.Equal(copied.Tags, []string{"infantry"}) {
		t.Errorf("copy %+v", copied)
	}

	moved, err := b.MoveCreature(r.ctx, r.gm, boy, cult.ID)
	if err != nil {
		t.Fatal(err)
	}
	if moved.ID != boy || moved.CollectionID != cult.ID {
		t.Errorf("moved %+v", moved)
	}

	if _, err := b.MoveCreature(r.ctx, r.gm, boy, theirs.ID); !errors.Is(err, ErrNoRecord) {
		t.Errorf("moved into another user's collection: %v", err)
	}
	if _, err := b.CopyCreature(r.ctx, r.gm, boy, into(theirs.ID)); !errors.Is(err, ErrNoRecord) {
		t.Errorf("copied into another user's collection: %v", err)
	}
	if _, err := b.CopyCreature(r.ctx, r.player, boy, into(theirs.ID)); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player copied the gamemaster's creature: %v", err)
	}

	// A copy into a new collection makes it; a copy that fails leaves none.
	fresh, err := b.CopyCreature(r.ctx, r.gm, boy, CollectionTarget{NewCollection: " Fresh "})
	if err != nil {
		t.Fatal(err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE id = $1 AND owner_id = $2 AND name = 'Fresh'`, fresh.CollectionID, r.gm); n != 1 {
		t.Errorf("no new collection %d", fresh.CollectionID)
	}
	for _, target := range []CollectionTarget{{NewCollection: "  "}, {CollectionID: cult.ID, NewCollection: "Both"}} {
		if _, err := b.CopyCreature(r.ctx, r.gm, boy, target); !errors.Is(err, ErrInvalidBestiaryRequest) {
			t.Errorf("%+v: %v", target, err)
		}
	}
	if _, err := b.CopyCreature(r.ctx, r.player, boy, CollectionTarget{NewCollection: "Stolen"}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player copied the gamemaster's creature into a new collection: %v", err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE name IN ('Both', 'Stolen')`); n != 0 {
		t.Errorf("%d collections left by failed copies", n)
	}
	if _, err := b.MoveCreature(r.ctx, r.player, boy, theirs.ID); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player took the gamemaster's creature: %v", err)
	}
}

func TestSaveToCollection(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "Orks")
	s := r.withNpcs(1)
	npc := s.Participants[0].SheetID
	r.exec(`UPDATE character_sheets SET content = jsonb_set(content, '{initiative,lastInitiative}', '7') WHERE id = $1`, npc)

	c, err := b.Save(r.ctx, r.gm, npc, into(orks.ID))
	if err != nil {
		t.Fatal(err)
	}
	if c.CollectionID != orks.ID || c.Name != newNpcName {
		t.Errorf("saved %+v", c)
	}
	if v := at(r.content(c.ID), "initiative", "lastInitiative"); v != float64(0) {
		t.Errorf("the creature has initiative %v", v)
	}

	// A player saves a character they can open, into their own collection only.
	mine := r.newCollection(r.player, "Mine")
	visible := r.sheet(r.gm, r.room, "Ulrich")
	if _, err := b.Save(r.ctx, r.player, visible, into(mine.ID)); err != nil {
		t.Errorf("a player saved a visible character: %v", err)
	}
	hidden := r.insert(`INSERT INTO character_sheets (owner_id, room_id, sheet_visibility) VALUES ($1, $2, 'hide_from_players')`, r.gm, r.room)
	if _, err := b.Save(r.ctx, r.player, hidden, into(mine.ID)); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player saved a hidden character: %v", err)
	}
	if _, err := b.Save(r.ctx, r.player, npc, into(mine.ID)); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player saved an NPC: %v", err)
	}
	if _, err := b.Save(r.ctx, r.gm, npc, into(mine.ID)); !errors.Is(err, ErrNoRecord) {
		t.Errorf("saved into another user's collection: %v", err)
	}

	var quota *QuotaError
	r.exec(`INSERT INTO character_sheets (owner_id, collection_id, content)
        VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		r.gm, orks.ID, incompressible(QuotaBytes))
	if _, err := b.Save(r.ctx, r.gm, npc, into(orks.ID)); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
	if _, err := b.Save(r.ctx, r.gm, npc, CollectionTarget{NewCollection: "Over"}); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE name = 'Over'`); n != 0 {
		t.Error("a save over the quota left its new collection")
	}
}

func TestAddVariant(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "Orks")
	boy := r.creature(r.gm, orks.ID, "Ork Boy")
	r.exec(`UPDATE character_sheets SET tags = '{infantry}' WHERE id = $1`, boy)
	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), boy, 2))
	npc, other := s.Participants[0], s.Participants[1]
	r.exec(`UPDATE character_sheets SET content = content || '{"armour": {"woundsMax": 14}, "initiative": {"lastInitiative": 7}}' WHERE id = $1`, npc.SheetID)

	nob, encounterID, err := b.AddVariant(r.ctx, r.gm, npc.SheetID, " Ork Nob ")
	if err != nil {
		t.Fatal(err)
	}
	content := r.content(nob.ID)
	if nob.ID == boy || nob.Name != "Ork Nob" || nob.CollectionID != orks.ID || !slices.Equal(nob.Tags, []string{"infantry"}) ||
		at(content, "armour", "woundsMax") != float64(14) || encounterID != s.ID {
		t.Errorf("variant %+v of encounter %d, %v", nob, encounterID, content["armour"])
	}
	if v := at(content, "initiative", "lastInitiative"); v != float64(0) {
		t.Errorf("the variant has initiative %v", v)
	}
	if at(r.content(boy), "armour", "woundsMax") != nil || at(r.content(boy), "characterInfo", "characterName") != "Ork Boy" {
		t.Errorf("the creature changed: %v", r.content(boy))
	}
	// The NPC goes on from the variant; the other one keeps the creature.
	s = r.must(r.encounters.Get(r.ctx, r.gm, s.ID))
	if p := s.Participants[0]; deref(p.SourceCreatureID) != nob.ID || deref2(p.SourceCreatureName) != "Ork Nob" {
		t.Errorf("NPC %+v", p)
	}
	if p := s.Participants[1]; deref(p.SourceCreatureID) != boy {
		t.Errorf("the other NPC %+v", p)
	}

	// The next variant goes next to the variant, under the NPC's name.
	bosses := r.newCollection(r.gm, "Bosses")
	if _, err := b.MoveCreature(r.ctx, r.gm, nob.ID, bosses.ID); err != nil {
		t.Fatal(err)
	}
	boss, _, err := b.AddVariant(r.ctx, r.gm, npc.SheetID, "")
	if err != nil {
		t.Fatal(err)
	}
	if boss.Name != npc.Name || boss.CollectionID != bosses.ID {
		t.Errorf("second variant %+v", boss)
	}
	if p := r.must(r.encounters.Get(r.ctx, r.gm, s.ID)).Participants[0]; deref(p.SourceCreatureID) != boss.ID {
		t.Errorf("NPC %+v", p)
	}

	for _, u := range []int{r.player, r.moderator, r.outsider} {
		if _, _, err := b.AddVariant(r.ctx, u, other.SheetID, ""); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("user %d added a variant: %v", u, err)
		}
	}
	if _, _, err := b.AddVariant(r.ctx, r.gm, r.sheet(r.player, r.room, "Ulrich"), ""); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a sheet of the room made a variant: %v", err)
	}
	// A new NPC has no creature, nor one of another user's.
	s = r.must(r.encounters.NewNpc(r.ctx, r.ref(s), KindBlackCrusade))
	theirs := r.newCollection(r.player, "Theirs")
	grot := r.creature(r.player, theirs.ID, "Grot")
	r.visibility(r.player, theirs.ID, VisibilityPublic)
	s = r.must(r.encounters.AddCreature(r.ctx, r.ref(s), grot, 1))
	for _, p := range s.Participants[2:] {
		if _, _, err := b.AddVariant(r.ctx, r.gm, p.SheetID, ""); !errors.Is(err, ErrInvalidBestiaryRequest) {
			t.Errorf("%s made a variant: %v", p.Name, err)
		}
	}
	if _, _, err := b.AddVariant(r.ctx, r.gm, other.SheetID, strings.Repeat("a", maxCreatureName+1)); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("too long a name: %v", err)
	}

	var quota *QuotaError
	// The variant is named anew: the filler is elsewhere in the sheet.
	r.exec(`UPDATE character_sheets SET content = content || jsonb_build_object('filler', $2::text) WHERE id = $1`,
		other.SheetID, incompressible(QuotaBytes*2/3))
	if _, _, err := b.AddVariant(r.ctx, r.gm, other.SheetID, "Big"); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
}

func TestDuplicateKeepsSource(t *testing.T) {
	r := newEncounterRoom(t)
	boy := r.creature(r.gm, r.newCollection(r.gm, "Orks").ID, "Ork Boy")
	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), boy, 1))
	r.exec(`UPDATE character_sheets SET source_label = 'Orks · Alex' WHERE id = $1`, s.Participants[0].SheetID)
	s = r.must(r.encounters.Duplicate(r.ctx, r.ref(s), s.Participants[0].ID, 2))
	// The source outlives the NPC the copies were made of.
	s = r.must(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[0].ID}))
	for _, p := range s.Participants {
		if deref(p.SourceCreatureID) != boy || deref2(p.SourceLabel) != "Orks · Alex" {
			t.Errorf("copy %+v", p)
		}
	}
}

func TestAddCreature(t *testing.T) {
	r := newEncounterRoom(t)
	orks := r.newCollection(r.gm, "Orks")
	boy := r.creature(r.gm, orks.ID, "Ork Boy")
	s := r.create("Ambush")

	s = r.must(r.encounters.AddCreature(r.ctx, r.ref(s), boy, 3))
	if got := []string{s.Participants[0].Name, s.Participants[1].Name, s.Participants[2].Name}; !slices.Equal(got, []string{"Ork Boy 1", "Ork Boy 2", "Ork Boy 3"}) {
		t.Errorf("names %v", got)
	}
	groups := map[int]bool{}
	for _, p := range s.Participants {
		groups[p.GroupID] = true
		if !p.NPC || p.SourceCreatureID == nil || *p.SourceCreatureID != boy {
			t.Errorf("participant %+v", p)
		}
	}
	if len(groups) != 3 {
		t.Errorf("%d groups, want one for each copy", len(groups))
	}
	s = r.must(r.encounters.AddCreature(r.ctx, r.ref(s), boy, 1))
	if name := s.Participants[3].Name; name != "Ork Boy 4" {
		t.Errorf("the fourth is %q", name)
	}

	for _, count := range []int{0, maxDuplicates + 1} {
		if _, err := r.encounters.AddCreature(r.ctx, r.ref(s), boy, count); !errors.Is(err, ErrInvalidEncounterRequest) {
			t.Errorf("count %d: %v", count, err)
		}
	}
	theirs := r.creature(r.player, r.newCollection(r.player, "Mine").ID, "Grot")
	if _, err := r.encounters.AddCreature(r.ctx, r.ref(s), theirs, 1); !errors.Is(err, ErrNoRecord) {
		t.Errorf("added another user's creature: %v", err)
	}

	var quota *QuotaError
	r.exec(`UPDATE character_sheets SET content = jsonb_set(content, '{characterInfo,characterName}', to_jsonb($2::text)) WHERE id = $1`,
		boy, incompressible(QuotaBytes/2))
	if _, err := r.encounters.AddCreature(r.ctx, r.ref(s), boy, 2); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
}

func TestUploadAndExport(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "Orks")
	sheet := func(name string) json.RawMessage {
		return json.RawMessage(`{"characterInfo": {"characterName": "` + name + `"}, "initiative": {"lastInitiative": 5}}`)
	}

	added, err := b.Upload(r.ctx, r.gm, orks.ID, []CreatureInFile{
		{SheetKind: KindBlackCrusade, Tags: []string{"infantry"}, Content: sheet("Ork Boy")},
		{SheetKind: KindPathfinderCrusade, Content: sheet("Mek")},
	})
	if err != nil || added != 2 {
		t.Fatalf("added %d, %v", added, err)
	}
	got, _ := b.Creatures(r.ctx, r.gm, CreatureFilter{CollectionID: &orks.ID})
	if !slices.Equal(names(got), []string{"Mek", "Ork Boy"}) || got[0].Kind != KindPathfinderCrusade {
		t.Errorf("creatures %+v", got)
	}
	if v := at(r.content(got[1].ID), "initiative", "lastInitiative"); v != float64(0) {
		t.Errorf("an uploaded creature has initiative %v", v)
	}

	// A file that is no sheet adds nothing, nor do the good ones beside it.
	_, err = b.Upload(r.ctx, r.gm, orks.ID, []CreatureInFile{
		{SheetKind: KindBlackCrusade, Content: sheet("Gretchin")},
		{SheetKind: KindBlackCrusade, Content: json.RawMessage(`{"characterInfo": {"characterName": 5}}`)},
	})
	if !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("got %v, want ErrInvalidBestiaryRequest", err)
	}
	if _, err := b.Upload(r.ctx, r.player, orks.ID, []CreatureInFile{{SheetKind: KindBlackCrusade, Content: sheet("Grot")}}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a player uploaded into the gamemaster's collection: %v", err)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE collection_id = $1`, orks.ID); n != 2 {
		t.Errorf("%d creatures, want 2", n)
	}

	big := json.RawMessage(`{"characterInfo": {"characterName": "` + incompressible(QuotaBytes) + `"}}`)
	var quota *QuotaError
	if _, err := b.Upload(r.ctx, r.gm, orks.ID, []CreatureInFile{{SheetKind: KindBlackCrusade, Content: big}}); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}

	if _, err := b.UpdateCollection(r.ctx, r.gm, orks.ID, CollectionEdit{Description: strp("Greenskins"), Tags: &[]string{"greenskins"}}); err != nil {
		t.Fatal(err)
	}
	f, err := b.Export(r.ctx, r.gm, orks.ID)
	if err != nil {
		t.Fatal(err)
	}
	if f.Format != "collection" || f.Version != 1 || f.Name != "Orks" || f.Description != "Greenskins" || !slices.Equal(f.Tags, []string{"greenskins"}) || len(f.Creatures) != 2 {
		t.Fatalf("file %+v", f)
	}
	boy := f.Creatures[1]
	var content map[string]any
	if err := json.Unmarshal(boy.Content, &content); err != nil {
		t.Fatal(err)
	}
	if boy.SheetKind != KindBlackCrusade || !slices.Equal(boy.Tags, []string{"infantry"}) || at(content, "characterInfo", "characterName") != "Ork Boy" || content["sheetKind"] != nil {
		t.Errorf("creature in the file %+v", boy)
	}

	// The exported file uploads back.
	cult := r.newCollection(r.gm, "Cult")
	if added, err := b.Upload(r.ctx, r.gm, cult.ID, f.Creatures); err != nil || added != 2 {
		t.Errorf("uploaded the export: %d, %v", added, err)
	}
}

func TestDefaultCollection(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	id := r.insert(`INSERT INTO bestiary_collections (owner_id, name, is_default) VALUES ($1, $2, true)`, r.player, defaultCollectionName)
	public := VisibilityPublic

	if _, err := b.UpdateCollection(r.ctx, r.player, id, CollectionEdit{Visibility: &public}); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("published the default collection: %v", err)
	}
	if _, err := b.DeleteCollection(r.ctx, r.player, id); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("deleted the default collection: %v", err)
	}
	c, err := b.UpdateCollection(r.ctx, r.player, id, CollectionEdit{Name: strp("Grots"), Description: strp("Small"), Tags: &[]string{"orks"}})
	if err != nil || c.Name != "Grots" || c.Description != "Small" || !c.Default || c.Visibility != VisibilityPrivate {
		t.Errorf("edited %+v, %v", c, err)
	}
	if _, err := r.pool.Exec(r.ctx, `INSERT INTO bestiary_collections (owner_id, name, is_default) VALUES ($1, 'Second', true)`, r.player); err == nil {
		t.Error("a second default collection")
	}
	if _, err := r.pool.Exec(r.ctx, `UPDATE bestiary_collections SET visibility = 'public' WHERE id = $1`, id); err == nil {
		t.Error("a public default collection")
	}
	// Another collection of the user is no default one.
	other := r.newCollection(r.player, "Orks")
	if other.Default {
		t.Errorf("new collection %+v", other)
	}
	if _, err := b.DeleteCollection(r.ctx, r.player, other.ID); err != nil {
		t.Errorf("deleted an ordinary collection: %v", err)
	}
}

func TestNewCreature(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.gm, "Orks")
	r.exec(`UPDATE bestiary_collections SET updated_at = now() - interval '1 day' WHERE id = $1`, orks.ID)

	c, err := b.NewCreature(r.ctx, r.gm, orks.ID, KindPathfinderCrusade)
	if err != nil {
		t.Fatal(err)
	}
	if c.CollectionID != orks.ID || c.Name != newCreatureName || c.Kind != KindPathfinderCrusade || len(c.Tags) != 0 {
		t.Errorf("new creature %+v", c)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE id = $1 AND updated_at > now() - interval '1 hour'`, orks.ID); n != 1 {
		t.Error("the collection did not move up the list")
	}
	if _, err := b.NewCreature(r.ctx, r.gm, orks.ID, SheetKind("nonsense")); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("a creature of no kind: %v", err)
	}

	theirs := r.newCollection(r.player, "Mine")
	if _, err := b.NewCreature(r.ctx, r.gm, theirs.ID, KindBlackCrusade); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a creature in another user's private collection: %v", err)
	}
	r.visibility(r.player, theirs.ID, VisibilityPublic)
	if _, err := b.NewCreature(r.ctx, r.gm, theirs.ID, KindBlackCrusade); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a creature in another user's public collection: %v", err)
	}

	r.exec(`INSERT INTO character_sheets (owner_id, collection_id, content)
        VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		r.gm, orks.ID, incompressible(QuotaBytes-100))
	var quota *QuotaError
	if _, err := b.NewCreature(r.ctx, r.gm, orks.ID, KindBlackCrusade); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE collection_id = $1`, orks.ID); n != 2 {
		t.Errorf("%d creatures, want the first and the filler", n)
	}
}
