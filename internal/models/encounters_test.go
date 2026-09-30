package models

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// encounterRoom is a room with a gamemaster, a moderator and a player, and a
// user of another room.
type encounterRoom struct {
	t          *testing.T
	ctx        context.Context
	pool       *pgxpool.Pool
	encounters *EncounterModel
	sheets     *CharacterSheetModel

	gm, moderator, player, outsider int
	room, other                     int
}

func newEncounterRoom(t *testing.T) *encounterRoom {
	t.Helper()
	pool := newSheetHomesTestDB(t)
	r := &encounterRoom{t: t, ctx: context.Background(), pool: pool, encounters: &EncounterModel{DB: pool}, sheets: &CharacterSheetModel{DB: pool}}
	user := func(name string) int {
		return r.insert(`INSERT INTO users (name, email, hashed_password, created) VALUES ($1, $2, '', now())`, name, name+"@example.com")
	}
	r.gm, r.moderator, r.player, r.outsider = user("gm"), user("moderator"), user("player"), user("outsider")
	r.room = r.insert(`INSERT INTO rooms DEFAULT VALUES`)
	r.other = r.insert(`INSERT INTO rooms DEFAULT VALUES`)
	for u, role := range map[int]string{r.gm: "gamemaster", r.moderator: "moderator", r.player: "player"} {
		r.exec(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)`, r.room, u, role)
	}
	r.exec(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'gamemaster')`, r.other, r.outsider)
	return r
}

func (r *encounterRoom) insert(sql string, args ...any) int {
	r.t.Helper()
	var id int
	if err := r.pool.QueryRow(r.ctx, sql+" RETURNING id", args...).Scan(&id); err != nil {
		r.t.Fatal(err)
	}
	return id
}

func (r *encounterRoom) exec(sql string, args ...any) {
	r.t.Helper()
	if _, err := r.pool.Exec(r.ctx, sql, args...); err != nil {
		r.t.Fatal(err)
	}
}

func (r *encounterRoom) sheet(owner, room int, name string) int {
	r.t.Helper()
	return r.insert(`INSERT INTO character_sheets (owner_id, room_id, content) VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		owner, room, name)
}

func (r *encounterRoom) create(name string) *EncounterState {
	r.t.Helper()
	s, err := r.encounters.Create(r.ctx, r.gm, r.room, name)
	if err != nil {
		r.t.Fatal(err)
	}
	return s
}

func (r *encounterRoom) ref(s *EncounterState) EncounterRef {
	return EncounterRef{UserID: r.gm, RoomID: r.room, EncounterID: s.ID}
}

// must fails the test on err and returns the state.
func (r *encounterRoom) must(s *EncounterState, err error) *EncounterState {
	r.t.Helper()
	if err != nil {
		r.t.Fatal(err)
	}
	return s
}

// withNpcs returns an encounter with `n` new NPCs, each in a group of its own.
func (r *encounterRoom) withNpcs(n int) *EncounterState {
	r.t.Helper()
	s := r.create("Ambush")
	for range n {
		s = r.must(r.encounters.NewNpc(r.ctx, r.ref(s), KindBlackCrusade))
	}
	return s
}

func (r *encounterRoom) count(sql string, args ...any) int {
	r.t.Helper()
	var n int
	if err := r.pool.QueryRow(r.ctx, sql, args...).Scan(&n); err != nil {
		r.t.Fatal(err)
	}
	return n
}

func groupOf(s *EncounterState, sheetID int) int {
	for _, p := range s.Participants {
		if p.SheetID == sheetID {
			return p.GroupID
		}
	}
	return 0
}

func groupIDs(s *EncounterState) []int {
	ids := make([]int, len(s.Groups))
	for i, g := range s.Groups {
		ids[i] = g.ID
	}
	return ids
}

func wantTurn(t *testing.T, s *EncounterState, group *int, round int) {
	t.Helper()
	if (group == nil) != (s.CurrentGroupID == nil) || (group != nil && *group != *s.CurrentGroupID) || s.Round != round {
		t.Fatalf("turn %v round %d, want %v round %d", deref(s.CurrentGroupID), s.Round, deref(group), round)
	}
}

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestEncounterIsTheGamemasters(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(1)
	npc := s.Participants[0].SheetID

	for _, u := range []int{r.moderator, r.player} {
		if _, err := r.encounters.Create(r.ctx, u, r.room, "Mine"); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("user %d created an encounter: %v", u, err)
		}
		if _, err := r.encounters.Next(r.ctx, EncounterRef{UserID: u, RoomID: r.room, EncounterID: s.ID}); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("user %d passed the turn: %v", u, err)
		}
		if _, err := r.encounters.Get(r.ctx, u, s.ID); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("user %d got the encounter: %v", u, err)
		}
	}
	// The gamemaster of another room, through the socket of that room.
	if _, err := r.encounters.Next(r.ctx, EncounterRef{UserID: r.outsider, RoomID: r.other, EncounterID: s.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("another room passed the turn: %v", err)
	}
	// The gamemaster, through the socket of another room.
	if _, err := r.encounters.Next(r.ctx, EncounterRef{UserID: r.gm, RoomID: r.other, EncounterID: s.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the encounter was changed through another room: %v", err)
	}

	t.Run("NPC", func(t *testing.T) {
		for u, want := range map[int]bool{r.gm: true, r.moderator: false, r.player: false, r.outsider: false} {
			var view, edit bool
			if err := r.pool.QueryRow(r.ctx, `SELECT can_view_character_sheet($1, $2), can_edit_character_sheet($1, $2)`, u, npc).Scan(&view, &edit); err != nil {
				t.Fatal(err)
			}
			if view != want || edit != want {
				t.Errorf("user %d: view %v edit %v, want %v", u, view, edit, want)
			}
		}
		a, err := r.sheets.Audience(r.ctx, npc)
		if err != nil {
			t.Fatal(err)
		}
		if a.RoomID != r.room || !slices.Equal(a.Viewers, []int{r.gm}) || !slices.Equal(a.Named, []int{r.gm}) {
			t.Errorf("audience %+v, want room %d and only the gamemaster %d", a, r.room, r.gm)
		}
		v, err := r.sheets.GetWithPermission(r.ctx, r.gm, npc)
		if err != nil {
			t.Fatal(err)
		}
		if v.HomeRoomID != r.room || v.CharacterSheet.RoomID != nil || deref(v.CharacterSheet.EncounterID) != s.ID {
			t.Errorf("home %d, room %v, encounter %v", v.HomeRoomID, deref(v.CharacterSheet.RoomID), deref(v.CharacterSheet.EncounterID))
		}
		if _, err := r.sheets.GetWithPermission(r.ctx, r.moderator, npc); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("the moderator opened the NPC: %v", err)
		}
	})

	// The rules of a room's sheet stay as they were.
	t.Run("character", func(t *testing.T) {
		sheet := r.sheet(r.player, r.room, "Ulrich")
		for u, want := range map[int]bool{r.gm: true, r.moderator: true, r.player: true, r.outsider: false} {
			var view bool
			if err := r.pool.QueryRow(r.ctx, `SELECT can_view_character_sheet($1, $2)`, u, sheet).Scan(&view); err != nil {
				t.Fatal(err)
			}
			if view != want {
				t.Errorf("user %d: view %v, want %v", u, view, want)
			}
		}
	})
}

func TestSheetHasOneHome(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	for name, home := range map[string][2]*int{"two": {&r.room, &s.ID}, "none": {nil, nil}} {
		_, err := r.pool.Exec(r.ctx, `INSERT INTO character_sheets (owner_id, room_id, encounter_id) VALUES ($1, $2, $3)`, r.gm, home[0], home[1])
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.ConstraintName != "one_home" {
			t.Errorf("%s homes: %v, want the one_home check to fail", name, err)
		}
	}
}

func TestDeletingEncounterTakesItsNpcs(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(2)
	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{character}))
	if _, err := r.encounters.Show(r.ctx, r.gm, r.room, &s.ID); err != nil {
		t.Fatal(err)
	}

	shown, err := r.encounters.Delete(r.ctx, r.ref(s))
	if err != nil {
		t.Fatal(err)
	}
	if !shown {
		t.Error("the deleted encounter was shown")
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE encounter_id IS NOT NULL`); n != 0 {
		t.Errorf("%d NPCs left", n)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1`, character); n != 1 {
		t.Error("the character went with the encounter")
	}
	if n := r.count(`SELECT count(*) FROM initiative_groups`) + r.count(`SELECT count(*) FROM encounter_participants`); n != 0 {
		t.Errorf("%d groups and participants left", n)
	}
	if view, err := r.encounters.ShownView(r.ctx, r.room); err != nil || view != nil {
		t.Errorf("shown view %v, %v; want none", view, err)
	}
}

func TestNewNpcKeepsToQuota(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	// An NPC that leaves less room than a new sheet takes.
	r.exec(`INSERT INTO character_sheets (owner_id, encounter_id, content)
        VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', repeat('x', $3))))`,
		r.gm, s.ID, QuotaBytes-1000)

	_, err := r.encounters.NewNpc(r.ctx, r.ref(s), KindBlackCrusade)
	var quota *QuotaError
	if !errors.As(err, &quota) {
		t.Fatalf("got %v, want a QuotaError", err)
	}
	if quota.Limit != QuotaBytes || quota.Used < QuotaBytes-1000 || quota.Adding < 1000 {
		t.Errorf("quota error %+v", quota)
	}
	used, err := r.sheets.QuotaUsed(r.ctx, r.gm)
	if err != nil || used != quota.Used {
		t.Errorf("used %d, %v; want %d", used, err, quota.Used)
	}
	// Characters in rooms do not count.
	if used, _ := r.sheets.QuotaUsed(r.ctx, r.player); used != 0 {
		t.Errorf("the player uses %d", used)
	}
}

func TestNextGoesRoundTheGroups(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(3)
	order := groupIDs(s)
	wantTurn(t, s, nil, 1)

	for _, want := range []struct {
		group, round int
	}{{order[0], 1}, {order[1], 1}, {order[2], 1}, {order[0], 2}} {
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))
		wantTurn(t, s, &want.group, want.round)
	}

	s = r.must(r.encounters.ResetInitiative(r.ctx, r.ref(s)))
	wantTurn(t, s, nil, 1)
}

func TestRemovingCurrentGroupPassesTurn(t *testing.T) {
	t.Run("to the next", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(3)
		order := groupIDs(s)
		r.must(r.encounters.Next(r.ctx, r.ref(s)))
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = r.must(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID}))
		wantTurn(t, s, &order[2], 1)
		if len(s.Groups) != 2 {
			t.Errorf("%d groups, want the empty one gone", len(s.Groups))
		}
		if n := r.count(`SELECT count(*) FROM character_sheets WHERE encounter_id = $1`, s.ID); n != 2 {
			t.Errorf("%d NPCs, want the removed one deleted", n)
		}
	})
	t.Run("after the last to the first", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(2)
		order := groupIDs(s)
		r.must(r.encounters.Next(r.ctx, r.ref(s)))
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = r.must(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID}))
		wantTurn(t, s, &order[0], 2)
	})
	t.Run("to none", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(1)
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = r.must(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[0].ID}))
		wantTurn(t, s, nil, 1)
		if len(s.Groups) != 0 {
			t.Errorf("groups left: %v", s.Groups)
		}
	})
	t.Run("not when another group goes", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(2)
		order := groupIDs(s)
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = r.must(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID}))
		wantTurn(t, s, &order[0], 1)
	})
}

// A player deletes their sheet while their group has the turn.
func TestDeletingSheetLeavesItsEncounters(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	first := r.withNpcs(1)
	first = r.must(r.encounters.AddSheets(r.ctx, r.ref(first), []int{sheet}))
	r.must(r.encounters.Next(r.ctx, r.ref(first)))
	first = r.must(r.encounters.Next(r.ctx, r.ref(first)))
	npcGroup := first.Groups[0].ID
	second := r.must(r.encounters.AddSheets(r.ctx, r.ref(r.create("Hive")), []int{sheet}))

	left, err := r.sheets.Delete(r.ctx, r.player, sheet)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(slices.Sorted(slices.Values(left)), []int{first.ID, second.ID}) {
		t.Errorf("left %v, want %d and %d", left, first.ID, second.ID)
	}
	first = r.must(r.encounters.Get(r.ctx, r.gm, first.ID))
	wantTurn(t, first, &npcGroup, 2)
	if len(first.Groups) != 1 || len(first.Participants) != 1 {
		t.Errorf("groups %v, participants %v", first.Groups, first.Participants)
	}
	second = r.must(r.encounters.Get(r.ctx, r.gm, second.ID))
	if len(second.Groups) != 0 {
		t.Errorf("groups left: %v", second.Groups)
	}

	// An NPC is not deleted as a sheet of the room.
	if _, err := r.sheets.Delete(r.ctx, r.gm, first.Participants[0].SheetID); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("an NPC was deleted as a sheet: %v", err)
	}
}

func TestGroupAndUngroup(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(3)
	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{character}))
	r.must(r.encounters.Next(r.ctx, r.ref(s)))
	s = r.must(r.encounters.Next(r.ctx, r.ref(s)))
	npcs := []int{s.Participants[0].ID, s.Participants[1].ID}

	if _, err := r.encounters.Group(r.ctx, r.ref(s), []int{npcs[0], s.Participants[3].ID}, ""); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("an NPC and a character grouped: %v", err)
	}

	// The second NPC had the turn: its new group takes it on.
	s = r.must(r.encounters.Group(r.ctx, r.ref(s), npcs, "Orcs"))
	group := groupOf(s, s.Participants[0].SheetID)
	if groupOf(s, s.Participants[1].SheetID) != group || len(s.Groups) != 3 {
		t.Fatalf("groups %v, participants %v", s.Groups, s.Participants)
	}
	wantTurn(t, s, &group, 1)
	if s.Groups[0].ID != group || s.Groups[0].Name == nil || *s.Groups[0].Name != "Orcs" {
		t.Errorf("the group is not first or not named: %v", s.Groups)
	}

	// The first member keeps the group and the turn; the other follows it.
	s = r.must(r.encounters.Ungroup(r.ctx, r.ref(s), group))
	if groupOf(s, s.Participants[0].SheetID) != group || s.Groups[0].Name != nil {
		t.Errorf("the first member left its group: %v %v", s.Groups, s.Participants)
	}
	second := groupOf(s, s.Participants[1].SheetID)
	if second == group || s.Groups[1].ID != second {
		t.Errorf("the second member is not in a group of its own next: %v %v", s.Groups, s.Participants)
	}
	wantTurn(t, s, &group, 1)
}

func TestAddSheets(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	sheet := r.sheet(r.player, r.room, "Ulrich")
	elsewhere := r.sheet(r.outsider, r.other, "Stranger")

	if _, err := r.encounters.AddSheets(r.ctx, r.ref(s), []int{sheet, elsewhere}); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a sheet of another room was added: %v", err)
	}
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{sheet, sheet}))
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{sheet}))
	if len(s.Participants) != 1 || s.Participants[0].NPC || s.Participants[0].Name != "Ulrich" {
		t.Errorf("participants %+v, want Ulrich once", s.Participants)
	}
}

func TestDuplicateNumbersCopies(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(1)
	npc := s.Participants[0]
	r.exec(`UPDATE character_sheets SET content = jsonb_set(content, '{characterInfo,characterName}', '"Orc"') WHERE id = $1`, npc.SheetID)
	s = r.must(r.encounters.SetDisplayName(r.ctx, r.ref(s), npc.ID, "  Figure in the shadows "))

	s = r.must(r.encounters.Duplicate(r.ctx, r.ref(s), npc.ID, 2))
	var names, shown []string
	for _, p := range s.Participants {
		names = append(names, p.Name)
		shown = append(shown, deref2(p.DisplayName))
	}
	if !slices.Equal(names, []string{"Orc", "Orc 2", "Orc 3"}) {
		t.Errorf("names %v", names)
	}
	if !slices.Equal(shown, []string{"Figure in the shadows", "Figure in the shadows", "Figure in the shadows"}) {
		t.Errorf("display names %v", shown)
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE source_sheet_id = $1 AND encounter_id = $2 AND owner_id = $3`, npc.SheetID, s.ID, r.gm); n != 2 {
		t.Errorf("%d copies know their source", n)
	}

	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{character}))
	if _, err := r.encounters.Duplicate(r.ctx, r.ref(s), s.Participants[3].ID, 1); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a character was duplicated: %v", err)
	}
}

func deref2(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func TestCopyNames(t *testing.T) {
	tests := []struct {
		name  string
		taken []string
		want  []string
	}{
		{"Orc", []string{"Orc"}, []string{"Orc 2", "Orc 3"}},
		{"Orc 2", []string{"Orc", "Orc 2", "Goblin 7"}, []string{"Orc 3", "Orc 4"}},
		{"Orc", []string{"Orc 1", "Orc 5", "Orcs 9"}, []string{"Orc 6", "Orc 7"}},
	}
	for _, tt := range tests {
		if got := copyNames(tt.name, tt.taken, 2); !slices.Equal(got, tt.want) {
			t.Errorf("copyNames(%q, %v) = %v, want %v", tt.name, tt.taken, got, tt.want)
		}
	}
}

func TestOrderShowsToPlayers(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(2)
	order := groupIDs(s)
	value := 12
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Figure", Value: &value}, {Name: "Orc"}}}

	s = r.must(r.encounters.Order(r.ctx, r.ref(s), map[int]int{order[0]: 1, order[1]: 0, 1_000_000: 5}, view))
	if !slices.Equal(groupIDs(s), []int{order[1], order[0]}) {
		t.Errorf("order %v, want %v", groupIDs(s), []int{order[1], order[0]})
	}
	if s.Shown || s.InitiativeView == nil || s.InitiativeView.Rows[0].Name != "Figure" {
		t.Errorf("shown %v, view %+v", s.Shown, s.InitiativeView)
	}

	if got, err := r.encounters.Show(r.ctx, r.gm, r.room, &s.ID); err != nil || got == nil || len(got.Rows) != 2 {
		t.Fatalf("shown view %+v, %v", got, err)
	}
	list, err := r.encounters.List(r.ctx, r.gm, r.room)
	if err != nil || deref(list.ShownEncounterID) != s.ID || len(list.Encounters) != 1 {
		t.Errorf("list %+v, %v", list, err)
	}
	if _, err := r.encounters.List(r.ctx, r.moderator, r.room); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the moderator listed the encounters: %v", err)
	}
	other := r.insert(`INSERT INTO encounters (room_id, name) VALUES ($1, 'Theirs')`, r.other)
	if _, err := r.encounters.Show(r.ctx, r.gm, r.room, &other); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("an encounter of another room was shown: %v", err)
	}
	if got, err := r.encounters.Show(r.ctx, r.gm, r.room, nil); err != nil || got != nil {
		t.Errorf("hidden, the view is %+v, %v", got, err)
	}
}

func TestCheckNpcs(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(2)
	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{character}))
	npcs := []int{s.Participants[0].SheetID, s.Participants[1].SheetID}

	if err := r.encounters.CheckNpcs(r.ctx, r.ref(s), npcs); err != nil {
		t.Errorf("NPCs: %v", err)
	}
	if err := r.encounters.CheckNpcs(r.ctx, r.ref(s), []int{npcs[0], character}); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a character: %v", err)
	}
	moderator := EncounterRef{UserID: r.moderator, RoomID: r.room, EncounterID: s.ID}
	if err := r.encounters.CheckNpcs(r.ctx, moderator, npcs); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the moderator: %v", err)
	}
}

func TestParseInitiativeView(t *testing.T) {
	long := strings.Repeat("x", maxInitiativeRowName+1)
	for raw, ok := range map[string]bool{
		`{"round":2,"current":1,"rows":[{"name":"A","value":3},{"name":"B","value":null}]}`: true,
		`{"round":1,"current":null,"rows":[]}`:                                              true,
		`{"round":0,"current":null,"rows":[]}`:                                              false,
		`{"round":1,"current":1,"rows":[{"name":"A","value":3}]}`:                           false,
		`{"round":1,"current":null,"rows":[{"name":"` + long + `","value":3}]}`:             false,
		`[]`: false,
	} {
		v, err := ParseInitiativeView(json.RawMessage(raw))
		if (err == nil) != ok {
			t.Errorf("%.60s: %v, want ok %v", raw, err, ok)
		}
		if ok && v.Rows == nil {
			t.Errorf("%.60s: rows are null", raw)
		}
	}
	// What else a client sends does not reach the players.
	v, _ := ParseInitiativeView(json.RawMessage(`{"round":1,"current":null,"rows":[{"name":"A","value":1,"wounds":7,"sheetId":3}]}`))
	if b, _ := json.Marshal(v); strings.Contains(string(b), "wounds") || strings.Contains(string(b), "sheetId") {
		t.Errorf("kept %s", b)
	}
}
