package models

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
)

// reread is the file as it comes back after a download: written and parsed.
func (r *encounterRoom) reread(f *EncounterFile) *EncounterFile {
	r.t.Helper()
	data, err := json.Marshal(f)
	if err != nil {
		r.t.Fatal(err)
	}
	parsed, err := ParseEncounterFile(data)
	if err != nil {
		r.t.Fatalf("parse %s: %v", data, err)
	}
	return parsed
}

func (r *encounterRoom) export(s *EncounterState) *EncounterFile {
	r.t.Helper()
	f, err := r.encounters.Export(r.ctx, r.gm, s.ID)
	if err != nil {
		r.t.Fatal(err)
	}
	return f
}

// npcFile is a file of NPCs named `names`, each in a group of its own.
func npcFile(round int, names ...string) *EncounterFile {
	f := &EncounterFile{Format: EncounterFileFormat, Version: EncounterFileVersion, Round: round}
	for _, name := range names {
		f.Npcs = append(f.Npcs, NpcInFile{
			SheetKind: KindBlackCrusade,
			Content:   json.RawMessage(fmt.Sprintf(`{"characterInfo": {"characterName": %q}}`, name)),
		})
	}
	return f
}

// npcNames is the names of the NPCs of the encounter in turn order.
func npcNames(s *EncounterState) []string {
	out := []string{}
	for _, g := range s.Groups {
		for _, p := range s.Participants {
			if p.GroupID == g.ID && p.NPC {
				out = append(out, p.Name)
			}
		}
	}
	return out
}

// ambush is an encounter in round 2 with a character, two NPCs of creature
// "Ork Boy" grouped as "Orks", one shown to the players as "Shadow", a new
// NPC, and two characters in a group of their own.
func (r *encounterRoom) ambush(boy int) *EncounterState {
	r.t.Helper()
	s := r.create("Ambush")
	hero, sidekick := r.sheet(r.player, r.room, "Hero"), r.sheet(r.player, r.room, "Sidekick")
	lone := r.sheet(r.moderator, r.room, "Lone")
	s = r.addToParty(s, hero, sidekick, lone)
	s = of(r.all(r.encounters.Group(r.ctx, r.ref(s), []int{s.Participants[0].ID, s.Participants[1].ID}, "Heroes")), s.ID)
	s = r.must(r.encounters.AddCreature(r.ctx, r.ref(s), boy, 2))
	orks := s.Participants[3:5]
	s = of(r.all(r.encounters.Group(r.ctx, r.ref(s), []int{orks[0].ID, orks[1].ID}, "Orks")), s.ID)
	s = of(r.all(r.encounters.SetDisplayName(r.ctx, r.ref(s), orks[0].ID, "Shadow")), s.ID)
	s = r.npc(s)
	r.exec(`UPDATE character_sheets SET content = jsonb_set(content, '{initiative}', '{"lastInitiative": 9}') WHERE encounter_id = $1`, s.ID)
	r.exec(`UPDATE encounters SET round = 2 WHERE id = $1`, s.ID)
	return r.must(r.encounters.Get(r.ctx, r.gm, s.ID))
}

func TestExportEncounter(t *testing.T) {
	r := newEncounterRoom(t)
	boy := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")
	s := r.ambush(boy)

	f := r.export(s)
	if f.Format != "encounter" || f.Version != 2 || f.Name != "Ambush" || f.Round != 2 {
		t.Errorf("file %+v", f)
	}
	// Only the groups of NPCs, in turn order.
	var npcGroups []string
	for _, g := range s.Groups {
		for _, p := range s.Participants {
			if p.GroupID == g.ID && p.NPC {
				npcGroups = append(npcGroups, deref2(g.Name))
				break
			}
		}
	}
	var fileGroups []string
	for _, g := range f.Groups {
		fileGroups = append(fileGroups, deref2(g.Name))
	}
	if !slices.Equal(fileGroups, npcGroups) || !slices.Contains(fileGroups, "Orks") || slices.Contains(fileGroups, "Heroes") {
		t.Errorf("groups %v, want %v", fileGroups, npcGroups)
	}
	if len(f.Npcs) != 3 {
		t.Fatalf("%d NPCs in the file, want 3", len(f.Npcs))
	}
	shown := 0
	for _, n := range f.Npcs {
		var content map[string]any
		if err := json.Unmarshal(n.Content, &content); err != nil {
			t.Fatal(err)
		}
		name := at(content, "characterInfo", "characterName")
		if v := at(content, "initiative", "lastInitiative"); v != float64(0) {
			t.Errorf("%v has initiative %v", name, v)
		}
		if name == "Hero" || name == "Sidekick" || name == "Lone" {
			t.Errorf("character %v is in the file", name)
		}
		if strings.HasPrefix(name.(string), "Ork Boy") {
			if deref(n.SourceSheetID) != boy {
				t.Errorf("%v has source %v, want %d", name, deref(n.SourceSheetID), boy)
			}
			if !slices.ContainsFunc(f.Groups, func(g GroupInFile) bool { return g.Ref == n.Group && deref2(g.Name) == "Orks" }) {
				t.Errorf("%v is in group %q", name, n.Group)
			}
		} else if n.SourceSheetID != nil {
			t.Errorf("%v has source %d", name, *n.SourceSheetID)
		}
		if deref2(n.DisplayName) == "Shadow" {
			shown++
		}
	}
	if shown != 1 {
		t.Errorf("%d NPCs shown as Shadow, want 1", shown)
	}

	for _, u := range []int{r.moderator, r.player, r.outsider} {
		if _, err := r.encounters.Export(r.ctx, u, s.ID); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("user %d exported the encounter: %v", u, err)
		}
	}
	if _, err := r.encounters.Export(r.ctx, r.gm, s.ID+1000); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a missing encounter: %v", err)
	}
}

func TestLoadEncounterFile(t *testing.T) {
	r := newEncounterRoom(t)
	orks := r.collection(r.gm, "Orks")
	boy := r.creature(r.gm, orks, "Ork Boy")
	s := r.ambush(boy)
	r.must(r.encounters.Order(r.ctx, r.ref(s), map[int]int{}, &InitiativeView{Round: 2, Rows: []InitiativeRow{}}))
	f := r.export(s)

	loaded, err := r.encounters.Load(r.ctx, r.gm, r.room, r.reread(f))
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ID == s.ID || loaded.Name != "Ambush" || loaded.Shown || loaded.InitiativeView != nil {
		t.Errorf("loaded %+v", loaded)
	}
	wantTurn(t, loaded, nil, 2)
	if got, want := npcNames(loaded), npcNames(s); !slices.Equal(got, want) {
		t.Errorf("NPCs %v, want %v", got, want)
	}
	groups := map[int]string{}
	for _, g := range loaded.Groups {
		groups[g.ID] = deref2(g.Name)
	}
	// The party of the room is in every encounter; the file has NPCs only.
	party := 0
	for _, p := range loaded.Participants {
		if !p.NPC {
			party++
			continue
		}
		isOrk := strings.HasPrefix(p.Name, "Ork Boy")
		if isOrk != (groups[p.GroupID] == "Orks") {
			t.Errorf("%s is in group %q", p.Name, groups[p.GroupID])
		}
		if isOrk != (deref(p.SourceCreatureID) == boy) {
			t.Errorf("%s has source %v", p.Name, deref(p.SourceCreatureID))
		}
		if v := at(r.content(p.SheetID), "initiative", "lastInitiative"); v != float64(0) {
			t.Errorf("%s has initiative %v", p.Name, v)
		}
	}
	if party != 3 {
		t.Errorf("%d characters, want the party of 3", party)
	}
	if !slices.ContainsFunc(loaded.Participants, func(p EncounterParticipant) bool { return deref2(p.DisplayName) == "Shadow" }) {
		t.Errorf("no NPC is shown as Shadow: %+v", loaded.Participants)
	}

	// Only a creature of the loader is a source; the label goes as it is.
	theirs := r.creature(r.player, r.collection(r.player, "Mine"), "Grot")
	gone := r.creature(r.gm, orks, "Gone")
	r.exec(`DELETE FROM character_sheets WHERE id = $1`, gone)
	npc := s.Participants[len(s.Participants)-1].SheetID
	room := r.sheet(r.gm, r.room, "Room sheet")
	f = npcFile(1, "Boy", "Grot", "Gone", "NPC", "Room sheet")
	for i, id := range []int{boy, theirs, gone, npc, room} {
		f.Npcs[i].SourceSheetID = &id
		f.Npcs[i].SourceLabel = strp(" Orks · Alex ")
	}
	loaded = r.must(r.encounters.Load(r.ctx, r.gm, r.room, r.reread(f)))
	for _, p := range loaded.Participants {
		if !p.NPC {
			continue
		}
		if want := p.Name == "Boy"; (p.SourceCreatureID != nil) != want {
			t.Errorf("%s has source %v", p.Name, deref(p.SourceCreatureID))
		}
		if deref2(p.SourceLabel) != "Orks · Alex" {
			t.Errorf("%s has label %q", p.Name, deref2(p.SourceLabel))
		}
	}
	// No name: named as "New encounter" names one.
	if loaded.Name != "Encounter 3" {
		t.Errorf("name %q", loaded.Name)
	}

	if _, err := r.encounters.Load(r.ctx, r.moderator, r.room, r.reread(f)); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the moderator loaded a file: %v", err)
	}
	if _, err := r.encounters.Load(r.ctx, r.gm, r.other, r.reread(f)); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("loaded into a room of another gamemaster: %v", err)
	}

	// The whole file or nothing.
	encounters := r.count(`SELECT count(*) FROM encounters`)
	sheets := r.count(`SELECT count(*) FROM character_sheets`)
	big := npcFile(1, "Small", incompressible(QuotaBytes))
	var quota *QuotaError
	if _, err := r.encounters.Load(r.ctx, r.gm, r.room, r.reread(big)); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
	if r.count(`SELECT count(*) FROM encounters`) != encounters || r.count(`SELECT count(*) FROM character_sheets`) != sheets {
		t.Error("a file over the quota left something")
	}
}

func TestParseEncounterFile(t *testing.T) {
	good := `{"format": "encounter", "version": 1, "name": " Ambush ", "round": 3,
        "groups": [{"ref": "g1", "name": " Orks "}, {"ref": "g2", "name": "  "}],
        "npcs": [{"group": "g1", "displayName": "", "content": {"characterInfo": {"characterName": "Boy"}}}]}`
	f, err := ParseEncounterFile([]byte(good))
	if err != nil {
		t.Fatal(err)
	}
	if f.Name != "Ambush" || deref2(f.Groups[0].Name) != "Orks" || f.Groups[1].Name != nil ||
		f.Npcs[0].DisplayName != nil || f.Npcs[0].SheetKind != DefaultSheetKind {
		t.Errorf("file %+v", f)
	}

	// Version 2 has a column for each NPC, the enemies by default.
	v2 := `{"format": "encounter", "version": 2, "name": "", "description": "", "round": 1,
        "groups": [{"ref": "g1", "name": null}, {"ref": "g2", "name": null}],
        "npcs": [{"group": "g1", "content": {}}, {"group": "g2", "side": "party", "content": {}}]}`
	f, err = ParseEncounterFile([]byte(v2))
	if err != nil {
		t.Fatal(err)
	}
	if f.Npcs[0].Side != SideEnemies || f.Npcs[1].Side != SideParty {
		t.Errorf("NPCs %+v", f.Npcs)
	}
	notes := strings.Replace(v2, `"description": ""`, `"description": "`+strings.Repeat("я", maxEncounterNotes)+`"`, 1)
	if _, err := ParseEncounterFile([]byte(notes)); err != nil {
		t.Errorf("notes of the longest: %v", err)
	}

	many := npcFile(1)
	for range maxInitiativeRows + 1 {
		many.Npcs = append(many.Npcs, NpcInFile{Content: json.RawMessage(`{}`)})
	}
	tooMany, _ := json.Marshal(many)
	for name, data := range map[string]string{
		"not json":       `{`,
		"format":         strings.Replace(good, `"encounter"`, `"collection"`, 1),
		"version":        strings.Replace(good, `"version": 1`, `"version": 3`, 1),
		"side":           strings.Replace(v2, `"side": "party"`, `"side": "neutral"`, 1),
		"group of both":  strings.Replace(v2, `"group": "g2"`, `"group": "g1"`, 1),
		"long notes":     strings.Replace(v2, `"description": ""`, `"description": "`+strings.Repeat("я", maxEncounterNotes+1)+`"`, 1),
		"round":          strings.Replace(good, `"round": 3`, `"round": 0`, 1),
		"huge round":     strings.Replace(good, `"round": 3`, `"round": 3000000000`, 1),
		"kind":           strings.Replace(good, `"group": "g1",`, `"group": "g1", "sheetKind": "dnd",`, 1),
		"group":          strings.Replace(good, `"group": "g1"`, `"group": "g3"`, 1),
		"repeated ref":   strings.Replace(good, `"ref": "g2"`, `"ref": "g1"`, 1),
		"content":        strings.Replace(good, `{"characterInfo": {"characterName": "Boy"}}`, `[]`, 1),
		"long name":      strings.Replace(good, ` Ambush `, strings.Repeat("a", maxEncounterName+1), 1),
		"too many NPCs":  string(tooMany),
		"no such format": `{"version": 1, "round": 1}`,
	} {
		if _, err := ParseEncounterFile([]byte(data)); !errors.Is(err, ErrInvalidEncounterRequest) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestReplaceNpcs(t *testing.T) {
	r := newEncounterRoom(t)
	boy := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")
	s := r.ambush(boy)
	var characters []EncounterParticipant
	var oldNpcs []int
	for _, p := range s.Participants {
		if p.NPC {
			oldNpcs = append(oldNpcs, p.SheetID)
		} else {
			characters = append(characters, p)
		}
	}
	s = r.must(r.encounters.Next(r.ctx, r.ref(s)))
	s = r.must(r.encounters.Order(r.ctx, r.ref(s), map[int]int{}, &InitiativeView{Round: 2, Rows: []InitiativeRow{{Name: "Ork Boy 1"}}}))

	f := npcFile(4, "Grot", "Snotling")
	f.Name = "Ignored"
	f.Groups = []GroupInFile{{Ref: "g1", Name: strp("Gretchin")}}
	f.Npcs[0].Group, f.Npcs[1].Group = "g1", "g1"
	replaced := r.must(r.encounters.ReplaceNpcs(r.ctx, r.ref(s), r.reread(f)))

	if replaced.Name != "Ambush" || replaced.InitiativeView != nil {
		t.Errorf("replaced %+v", replaced)
	}
	wantTurn(t, replaced, nil, 4)
	if got := npcNames(replaced); !slices.Equal(got, []string{"Grot", "Snotling"}) {
		t.Errorf("NPCs %v", got)
	}
	var kept []EncounterParticipant
	for _, p := range replaced.Participants {
		if !p.NPC {
			kept = append(kept, p)
		}
	}
	if !slices.Equal(kept, characters) {
		t.Errorf("characters %+v, want %+v", kept, characters)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = ANY($1)`, oldNpcs); n != 0 {
		t.Errorf("%d old NPCs are left", n)
	}
	// The one of the file, and the groups of the characters, unsorted here.
	if len(replaced.Groups) != 3 || deref2(replaced.Groups[0].Name) != "Gretchin" {
		t.Errorf("groups %+v", replaced.Groups)
	}

	// The NPCs it replaces free their place in the quota.
	big := npcFile(1, incompressible(QuotaBytes*2/3))
	replaced = r.must(r.encounters.ReplaceNpcs(r.ctx, r.ref(replaced), r.reread(big)))
	replaced = r.must(r.encounters.ReplaceNpcs(r.ctx, r.ref(replaced), r.reread(big)))
	var quota *QuotaError
	r.exec(`INSERT INTO character_sheets (owner_id, encounter_id, content) VALUES ($1, $2, jsonb_build_object('filler', $3::text))`,
		r.gm, r.create("Other").ID, incompressible(QuotaBytes/2))
	if _, err := r.encounters.ReplaceNpcs(r.ctx, r.ref(replaced), r.reread(big)); !errors.As(err, &quota) {
		t.Fatalf("got %v, want a QuotaError", err)
	}
	if quota.Adding < QuotaBytes*2/3 || quota.Used > QuotaBytes/2+QuotaBytes/100 {
		t.Errorf("quota error %+v: Used should leave out the NPCs replaced", quota)
	}
	if got := r.must(r.encounters.Get(r.ctx, r.gm, s.ID)); len(npcNames(got)) != 1 {
		t.Errorf("a refused file changed the NPCs: %v", npcNames(got))
	}

	for _, ref := range []EncounterRef{
		{UserID: r.moderator, RoomID: r.room, EncounterID: s.ID},
		{UserID: r.outsider, RoomID: r.other, EncounterID: s.ID},
		{UserID: r.gm, RoomID: r.other, EncounterID: s.ID},
	} {
		if _, err := r.encounters.ReplaceNpcs(r.ctx, ref, r.reread(f)); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("%+v replaced the NPCs: %v", ref, err)
		}
	}
}

// A file keeps the column of each NPC and the notes; "Replace NPCs" takes the
// columns but keeps the notes of the encounter.
func TestEncounterFileKeepsColumnsAndNotes(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.ambush(r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy"))
	ally := s.Participants[len(s.Participants)-1]
	s = of(r.all(r.encounters.Move(r.ctx, r.ref(s), ally.ID, SideParty)), s.ID)
	s = r.must(r.encounters.Describe(r.ctx, r.ref(s), "Orks in the ruins"))

	f := r.reread(r.export(s))
	if f.Description != "Orks in the ruins" {
		t.Errorf("notes %q", f.Description)
	}
	loaded := r.must(r.encounters.Load(r.ctx, r.gm, r.room, f))
	if loaded.Description != "Orks in the ruins" {
		t.Errorf("loaded notes %q", loaded.Description)
	}
	columns := func(s *EncounterState) map[string]string {
		sides := map[string]string{}
		for _, p := range s.Participants {
			if p.NPC {
				sides[p.Name] = p.Side
			}
		}
		return sides
	}
	want := map[string]string{"Ork Boy 1": SideEnemies, "Ork Boy 2": SideEnemies, ally.Name: SideParty}
	if got := columns(loaded); !maps.Equal(got, want) {
		t.Errorf("columns %v, want %v", got, want)
	}

	f.Description = "Other notes"
	replaced := r.must(r.encounters.ReplaceNpcs(r.ctx, r.ref(s), f))
	if replaced.Description != "Orks in the ruins" {
		t.Errorf("notes after a replace %q", replaced.Description)
	}
	if got := columns(replaced); !maps.Equal(got, want) {
		t.Errorf("columns after a replace %v, want %v", got, want)
	}

	// Version 1 has neither: its NPCs are enemies, whatever it says.
	v1, err := ParseEncounterFile([]byte(`{"format": "encounter", "version": 1, "name": "Old", "description": "Notes", "round": 1,
        "groups": [], "npcs": [{"side": "party", "content": {"characterInfo": {"characterName": "Grot"}}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	old := r.must(r.encounters.Load(r.ctx, r.gm, r.room, v1))
	if old.Description != "" || !maps.Equal(columns(old), map[string]string{"Grot": SideEnemies}) {
		t.Errorf("loaded from version 1: %q %v", old.Description, columns(old))
	}
}
