package models

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

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

// party is the gamemaster's change of the party that names no encounter.
func (r *encounterRoom) party() EncounterRef {
	return EncounterRef{UserID: r.gm, RoomID: r.room}
}

// must fails the test on err and returns the state.
func (r *encounterRoom) must(s *EncounterState, err error) *EncounterState {
	r.t.Helper()
	if err != nil {
		r.t.Fatal(err)
	}
	return s
}

// all returns the states of the encounters a change reached, by id. The
// change has the state of the encounter it named only, which must be the same
// as read after it.
func (r *encounterRoom) all(c *EncountersChange, err error) []*EncounterState {
	r.t.Helper()
	if err != nil {
		r.t.Fatal(err)
	}
	states := make([]*EncounterState, len(c.Versions))
	for i, v := range c.Versions {
		states[i] = r.must(r.encounters.State(r.ctx, v.ID))
		if states[i].Version != v.Version {
			r.t.Errorf("encounter %d at version %d, the change says %d", v.ID, states[i].Version, v.Version)
		}
		if c.State != nil && c.State.ID == v.ID && !reflect.DeepEqual(c.State, states[i]) {
			r.t.Errorf("the change has state %+v, read after it %+v", c.State, states[i])
		}
	}
	return states
}

// of returns the state of encounter `id` among the states, nil if none.
func of(states []*EncounterState, id int) *EncounterState {
	for _, s := range states {
		if s.ID == id {
			return s
		}
	}
	return nil
}

// addToParty adds the sheets to the party of the room and returns the new
// state of encounter s.
func (r *encounterRoom) addToParty(s *EncounterState, sheetIDs ...int) *EncounterState {
	r.t.Helper()
	return of(r.all(r.encounters.PartyAdd(r.ctx, r.ref(s), sheetIDs)), s.ID)
}

// withNpcs returns an encounter with `n` new NPCs, each in a group of its own.
func (r *encounterRoom) withNpcs(n int) *EncounterState {
	r.t.Helper()
	s := r.create("Ambush")
	for range n {
		s = r.npc(s)
	}
	return s
}

// npc adds a blank NPC no creature is the source of, as another user's
// encounter file brings it: a new creature of the gamemaster's added and
// deleted.
func (r *encounterRoom) npc(s *EncounterState) *EncounterState {
	r.t.Helper()
	blank, err := r.bestiary().NewCreature(r.ctx, r.gm, r.collection(r.gm, "Blank"), KindBlackCrusade)
	if err != nil {
		r.t.Fatal(err)
	}
	r.must(r.encounters.AddCreature(r.ctx, r.ref(s), blank.ID, 1))
	r.exec(`DELETE FROM character_sheets WHERE id = $1`, blank.ID)
	return r.must(r.encounters.Get(r.ctx, r.gm, s.ID))
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
		if a.RoomID != r.room || !slices.Equal(a.Viewers, []int{r.gm}) || !slices.Equal(a.Named, []int{r.gm}) || a.CollectionOwnerID != 0 {
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
	s = r.addToParty(s, character)
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
	if n := r.count(`SELECT count(*) FROM initiative_groups WHERE encounter_id IS NOT NULL`) + r.count(`SELECT count(*) FROM encounter_participants WHERE encounter_id IS NOT NULL`); n != 0 {
		t.Errorf("%d groups and participants left", n)
	}
	// The character stays in the party of the room.
	if n := r.count(`SELECT count(*) FROM encounter_participants WHERE room_id = $1 AND sheet_id = $2`, r.room, character); n != 1 {
		t.Error("the character left the party with the encounter")
	}
	if view, err := r.encounters.ShownView(r.ctx, r.room); err != nil || view != nil {
		t.Errorf("shown view %v, %v; want none", view, err)
	}
}

func TestAddCreatureKeepsToQuota(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	grot := r.creature(r.gm, r.collection(r.gm, "Orks"), incompressible(200))
	// An NPC that leaves less room than a copy of the creature takes.
	r.exec(`INSERT INTO character_sheets (owner_id, encounter_id, content)
        VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		r.gm, s.ID, incompressible(QuotaBytes-100))

	_, err := r.encounters.AddCreature(r.ctx, r.ref(s), grot, 1)
	var quota *QuotaError
	if !errors.As(err, &quota) {
		t.Fatalf("got %v, want a QuotaError", err)
	}
	if quota.Limit != QuotaBytes || quota.Used < QuotaBytes-100 || quota.Adding < 100 {
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

func TestPrevGoesBackRoundTheGroups(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(3)
	order := groupIDs(s)
	s = r.must(r.encounters.Prev(r.ctx, r.ref(s)))
	wantTurn(t, s, nil, 1)

	for range 4 {
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))
	}
	for _, want := range []struct {
		group, round int
	}{{order[2], 1}, {order[1], 1}, {order[0], 1}} {
		s = r.must(r.encounters.Prev(r.ctx, r.ref(s)))
		wantTurn(t, s, &want.group, want.round)
	}
	s = r.must(r.encounters.Prev(r.ctx, r.ref(s)))
	wantTurn(t, s, nil, 1)
}

func TestRemovingCurrentGroupPassesTurn(t *testing.T) {
	t.Run("to the next", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(3)
		order := groupIDs(s)
		r.must(r.encounters.Next(r.ctx, r.ref(s)))
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = of(r.all(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID})), s.ID)
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

		s = of(r.all(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID})), s.ID)
		wantTurn(t, s, &order[0], 2)
	})
	t.Run("to none", func(t *testing.T) {
		r := newEncounterRoom(t)
		s := r.withNpcs(1)
		s = r.must(r.encounters.Next(r.ctx, r.ref(s)))

		s = of(r.all(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[0].ID})), s.ID)
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

		s = of(r.all(r.encounters.Remove(r.ctx, r.ref(s), []int{s.Participants[1].ID})), s.ID)
		wantTurn(t, s, &order[0], 1)
	})
}

// A player deletes their sheet while their group has the turn.
func TestDeletingSheetLeavesItsEncounters(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	first := r.withNpcs(1)
	first = r.addToParty(first, sheet)
	r.must(r.encounters.Next(r.ctx, r.ref(first)))
	first = r.must(r.encounters.Next(r.ctx, r.ref(first)))
	npcGroup := first.Groups[0].ID
	second := r.addToParty(r.create("Hive"), sheet)
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Orc"}, {Name: "Ulrich"}}}
	r.must(r.encounters.Order(r.ctx, r.ref(first), map[int]int{}, view))

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
	// The view had a row of the deleted sheet.
	if first.InitiativeView != nil {
		t.Errorf("view %+v, want none", first.InitiativeView)
	}
	second = r.must(r.encounters.Get(r.ctx, r.gm, second.ID))
	if len(second.Groups) != 0 {
		t.Errorf("groups left: %v", second.Groups)
	}
	if n := r.count(`SELECT count(*) FROM initiative_groups WHERE room_id = $1`, r.room); n != 0 {
		t.Errorf("%d groups left in the party", n)
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
	s = r.addToParty(s, character)
	r.must(r.encounters.Next(r.ctx, r.ref(s)))
	s = r.must(r.encounters.Next(r.ctx, r.ref(s)))
	npcs := []int{s.Participants[0].ID, s.Participants[1].ID}

	if _, err := r.encounters.Group(r.ctx, r.ref(s), []int{npcs[0], s.Participants[3].ID}, ""); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("an NPC and a character grouped: %v", err)
	}

	// The second NPC had the turn: its new group takes it on.
	s = of(r.all(r.encounters.Group(r.ctx, r.ref(s), npcs, "Orcs")), s.ID)
	group := groupOf(s, s.Participants[0].SheetID)
	if groupOf(s, s.Participants[1].SheetID) != group || len(s.Groups) != 3 {
		t.Fatalf("groups %v, participants %v", s.Groups, s.Participants)
	}
	wantTurn(t, s, &group, 1)
	if s.Groups[0].ID != group || s.Groups[0].Name == nil || *s.Groups[0].Name != "Orcs" {
		t.Errorf("the group is not first or not named: %v", s.Groups)
	}

	// The first member keeps the group and the turn; the other follows it.
	s = of(r.all(r.encounters.Ungroup(r.ctx, r.ref(s), group)), s.ID)
	if groupOf(s, s.Participants[0].SheetID) != group || s.Groups[0].Name != nil {
		t.Errorf("the first member left its group: %v %v", s.Groups, s.Participants)
	}
	second := groupOf(s, s.Participants[1].SheetID)
	if second == group || s.Groups[1].ID != second {
		t.Errorf("the second member is not in a group of its own next: %v %v", s.Groups, s.Participants)
	}
	wantTurn(t, s, &group, 1)
}

func TestPartyAdd(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")
	elsewhere := r.sheet(r.outsider, r.other, "Stranger")

	// A room without encounters has its party all the same.
	if states := r.all(r.encounters.PartyAdd(r.ctx, r.party(), []int{sheet})); len(states) != 0 {
		t.Errorf("states %+v of a room without encounters", states)
	}
	s := r.create("Ambush")
	if _, err := r.encounters.PartyAdd(r.ctx, r.ref(s), []int{sheet, elsewhere}); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a sheet of another room was added: %v", err)
	}
	npcs := r.withNpcs(1)
	npc := npcs.Participants[len(npcs.Participants)-1].SheetID
	if _, err := r.encounters.PartyAdd(r.ctx, r.ref(s), []int{npc}); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("an NPC of another encounter was added: %v", err)
	}
	if _, err := r.encounters.PartyAdd(r.ctx, EncounterRef{UserID: r.player, RoomID: r.room}, []int{sheet}); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player changed the party: %v", err)
	}
	s = r.addToParty(s, sheet, sheet)
	if len(s.Participants) != 1 || s.Participants[0].NPC || s.Participants[0].Name != "Ulrich" {
		t.Errorf("participants %+v, want Ulrich once", s.Participants)
	}
}

// A sheet added to the party of a room without encounters while another
// change adds it is found there, not added twice.
func TestPartyAddWhileAnotherAdds(t *testing.T) {
	r := newEncounterRoom(t)
	sheet := r.sheet(r.player, r.room, "Ulrich")

	// The other change, halfway: it holds the room, as mutateParty does, and
	// has added the sheet.
	tx, err := r.pool.Begin(r.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(r.ctx)
	_, err = tx.Exec(r.ctx, `SELECT 1 FROM rooms WHERE id = $1 FOR NO KEY UPDATE`, r.room)
	if err == nil {
		_, err = tx.Exec(r.ctx, `
            WITH g AS (INSERT INTO initiative_groups (room_id) VALUES ($1) RETURNING id)
            INSERT INTO encounter_participants (room_id, group_id, sheet_id, side) SELECT $1, g.id, $2, 'party' FROM g`, r.room, sheet)
	}
	if err != nil {
		t.Fatal(err)
	}
	added := make(chan error, 1)
	go func() {
		_, err := r.encounters.PartyAdd(r.ctx, r.party(), []int{sheet})
		added <- err
	}()
	for waiting := false; !waiting; {
		err := r.pool.QueryRow(r.ctx, `
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                           WHERE wait_event_type = 'Lock' AND datname = current_database())`).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(r.ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-added; err != nil {
		t.Errorf("add: %v", err)
	}
}

// The party of the room is in each of its encounters, with a place of its own
// in the turn order of each.
func TestPartyIsInEveryEncounter(t *testing.T) {
	r := newEncounterRoom(t)
	a := r.withNpcs(2)
	ulrich := r.sheet(r.player, r.room, "Ulrich")
	a = r.addToParty(a, ulrich)
	party := groupOf(a, ulrich)
	npcs := groupIDs(a)[:2]
	if !slices.Equal(groupIDs(a), []int{npcs[0], npcs[1], party}) || !a.Groups[2].Room || a.Groups[0].Room {
		t.Fatalf("groups %+v, want the party's last", a.Groups)
	}
	r.exec(`UPDATE encounters SET description = 'Orks in the ruins' WHERE id = $1`, a.ID)
	b := r.npc(r.create("Hive"))
	theirs := b.Groups[0].ID

	// Not yet sorted in B, the party's group comes after B's own.
	if !slices.Equal(groupIDs(b), []int{theirs, party}) || b.Groups[1].Position != nil {
		t.Errorf("groups of B %+v", b.Groups)
	}
	var character *EncounterParticipant
	for i, p := range b.Participants {
		if p.SheetID == ulrich {
			character = &b.Participants[i]
		}
	}
	if character == nil || character.NPC || character.Side != "party" || b.Participants[1].Side != "enemies" {
		t.Errorf("participants of B %+v", b.Participants)
	}

	// Sorting A moves the party there only; a group of A is not B's to sort.
	a = r.must(r.encounters.Order(r.ctx, r.ref(a), map[int]int{party: 0, npcs[0]: 1, npcs[1]: 2}, nil))
	if !slices.Equal(groupIDs(a), []int{party, npcs[0], npcs[1]}) {
		t.Errorf("order of A %v", groupIDs(a))
	}
	b = r.must(r.encounters.Order(r.ctx, r.ref(b), map[int]int{party: 5, theirs: 3, npcs[0]: 0}, nil))
	if !slices.Equal(groupIDs(b), []int{theirs, party}) {
		t.Errorf("order of B %v", groupIDs(b))
	}
	a = r.must(r.encounters.Get(r.ctx, r.gm, a.ID))
	if !slices.Equal(groupIDs(a), []int{party, npcs[0], npcs[1]}) {
		t.Errorf("sorting B changed A: %v", groupIDs(a))
	}

	// "Next" takes the party's group in turn.
	for _, want := range []struct {
		group, round int
	}{{party, 1}, {npcs[0], 1}, {npcs[1], 1}, {party, 2}} {
		a = r.must(r.encounters.Next(r.ctx, r.ref(a)))
		wantTurn(t, a, &want.group, want.round)
	}
	wantTurn(t, b, nil, 1)

	if a.Description != "Orks in the ruins" || b.Description != "" {
		t.Errorf("descriptions %q and %q", a.Description, b.Description)
	}
}

func TestDuplicateNumbersCopies(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(1)
	npc := s.Participants[0]
	r.exec(`UPDATE character_sheets SET content = jsonb_set(content, '{characterInfo,characterName}', '"Orc"') WHERE id = $1`, npc.SheetID)
	s = of(r.all(r.encounters.SetDisplayName(r.ctx, r.ref(s), npc.ID, "  Figure in the shadows ")), s.ID)

	s = r.must(r.encounters.Duplicate(r.ctx, r.ref(s), npc.ID, 2))
	var names, shown []string
	for _, p := range s.Participants {
		names = append(names, p.Name)
		shown = append(shown, deref2(p.DisplayName))
	}
	if !slices.Equal(names, []string{"Orc 1", "Orc 2", "Orc 3"}) {
		t.Errorf("names %v", names)
	}
	if !slices.Equal(shown, []string{"Figure in the shadows", "Figure in the shadows", "Figure in the shadows"}) {
		t.Errorf("display names %v", shown)
	}
	// A new NPC is of no creature, nor are its copies.
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE source_sheet_id IS NULL AND encounter_id = $1 AND owner_id = $2`, s.ID, r.gm); n != 3 {
		t.Errorf("%d NPCs without a source, want 3", n)
	}

	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.addToParty(s, character)
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
		name       string
		taken      []string
		count      int
		want       []string
		renumbered string
	}{
		{"Orc", []string{"Goblin"}, 1, []string{"Orc"}, ""},
		{"Orc 7", nil, 1, []string{"Orc 7"}, ""},
		{"Orc", nil, 2, []string{"Orc 1", "Orc 2"}, ""},
		{"Orc", []string{"Orc"}, 1, []string{"Orc 2"}, "Orc"},
		{"Orc 2", []string{"Orc", "Orc 2", "Goblin 7"}, 2, []string{"Orc 3", "Orc 4"}, "Orc"},
		{"Orc", []string{"Orc", "Orc 1"}, 1, []string{"Orc 2"}, ""},
		{"Orc", []string{"Orc", "Orc"}, 1, []string{"Orc 2"}, ""},
		{"Orc", []string{"Orc 1", "Orc 5", "Orcs 9"}, 2, []string{"Orc 6", "Orc 7"}, ""},
	}
	for _, tt := range tests {
		got, renumbered := copyNames(tt.name, tt.taken, tt.count)
		if !slices.Equal(got, tt.want) || renumbered != tt.renumbered {
			t.Errorf("copyNames(%q, %v, %d) = %v, %q, want %v, %q", tt.name, tt.taken, tt.count, got, renumbered, tt.want, tt.renumbered)
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

func TestDropView(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(1)
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Orc"}}}
	s = r.must(r.encounters.Order(r.ctx, r.ref(s), map[int]int{}, view))
	if _, err := r.encounters.Show(r.ctx, r.gm, r.room, &s.ID); err != nil {
		t.Fatal(err)
	}

	s = r.must(r.encounters.DropView(r.ctx, r.ref(s)))
	if !s.Shown || s.InitiativeView != nil {
		t.Errorf("shown %v, view %+v, want shown with no view", s.Shown, s.InitiativeView)
	}
	if got, err := r.encounters.ShownView(r.ctx, r.room); err != nil || got != nil {
		t.Errorf("the players see %+v, %v", got, err)
	}
	if _, err := r.encounters.DropView(r.ctx, EncounterRef{UserID: r.moderator, RoomID: r.room, EncounterID: s.ID}); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the moderator dropped the view: %v", err)
	}
}

func TestCheckNpcs(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.withNpcs(2)
	character := r.sheet(r.player, r.room, "Ulrich")
	s = r.addToParty(s, character)
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

func participant(s *EncounterState, sheetID int) *EncounterParticipant {
	for i, p := range s.Participants {
		if p.SheetID == sheetID {
			return &s.Participants[i]
		}
	}
	return nil
}

// twoEncounters returns encounters A and B of the room, each with an NPC, and
// Ulrich and Gerta added to the party, in this order.
func (r *encounterRoom) twoEncounters() (a, b *EncounterState, ulrich, gerta int) {
	r.t.Helper()
	a, b = r.withNpcs(1), r.withNpcs(1)
	ulrich, gerta = r.sheet(r.player, r.room, "Ulrich"), r.sheet(r.moderator, r.room, "Gerta")
	states := r.all(r.encounters.PartyAdd(r.ctx, r.party(), []int{ulrich, gerta}))
	if len(states) != 2 || states[0].ID != a.ID || states[1].ID != b.ID {
		r.t.Fatalf("states %+v, want A and B", states)
	}
	return states[0], states[1], ulrich, gerta
}

func TestPartyChangesReachEveryEncounter(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, gerta := r.twoEncounters()
	for _, s := range []*EncounterState{a, b} {
		if p := participant(s, ulrich); p == nil || p.NPC || p.Side != SideParty {
			t.Errorf("Ulrich in %d: %+v", s.ID, p)
		}
	}
	if groupOf(a, ulrich) != groupOf(b, ulrich) {
		t.Errorf("Ulrich in groups %d and %d", groupOf(a, ulrich), groupOf(b, ulrich))
	}
	ids := []int{participant(a, ulrich).ID, participant(a, gerta).ID}

	states := r.all(r.encounters.Group(r.ctx, r.ref(b), ids, "Heroes"))
	heroes := groupOf(states[0], ulrich)
	for _, s := range states {
		if groupOf(s, ulrich) != heroes || groupOf(s, gerta) != heroes || len(s.Groups) != 2 {
			t.Errorf("groups of %d: %+v %+v", s.ID, s.Groups, s.Participants)
		}
	}

	// Gerta goes over alone; Ulrich keeps the group.
	states = r.all(r.encounters.Move(r.ctx, r.ref(a), ids[1], SideEnemies))
	if len(states) != 2 {
		t.Fatalf("states %+v", states)
	}
	for _, s := range states {
		g := participant(s, gerta)
		if g.Side != SideEnemies || g.GroupID == heroes || groupOf(s, ulrich) != heroes || participant(s, ulrich).Side != SideParty {
			t.Errorf("participants of %d: %+v", s.ID, s.Participants)
		}
	}
	if _, err := r.encounters.Group(r.ctx, r.ref(a), ids, ""); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a group across the columns: %v", err)
	}
	if _, err := r.encounters.Move(r.ctx, r.ref(a), ids[0], "neutral"); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("moved to no column: %v", err)
	}
	player := EncounterRef{UserID: r.player, RoomID: r.room, EncounterID: a.ID}
	if _, err := r.encounters.Move(r.ctx, player, ids[0], SideEnemies); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player moved a character: %v", err)
	}

	// An NPC moves in its encounter only, and its copies stay in its column.
	npc := a.Participants[0]
	states = r.all(r.encounters.Move(r.ctx, r.ref(a), npc.ID, SideParty))
	if len(states) != 1 || states[0].ID != a.ID || participant(states[0], npc.SheetID).Side != SideParty {
		t.Fatalf("states %+v", states)
	}
	a = r.must(r.encounters.Duplicate(r.ctx, r.ref(a), npc.ID, 1))
	if copied := a.Participants[len(a.Participants)-1]; !copied.NPC || copied.Side != SideParty {
		t.Errorf("copy %+v", copied)
	}
	b = r.must(r.encounters.Get(r.ctx, r.gm, b.ID))
	if b.Participants[0].Side != SideEnemies {
		t.Errorf("the NPC of B moved: %+v", b.Participants[0])
	}
}

// A move changes no turn order, so the views stay.
func TestMoveKeepsViews(t *testing.T) {
	r := newEncounterRoom(t)
	a, _, ulrich, _ := r.twoEncounters()
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Ulrich"}}}
	r.must(r.encounters.Order(r.ctx, r.ref(a), map[int]int{}, view))
	states := r.all(r.encounters.Move(r.ctx, r.ref(a), participant(a, ulrich).ID, SideEnemies))
	if a = of(states, a.ID); a.InitiativeView == nil {
		t.Errorf("the view of A is gone")
	}
}

func TestPartyGroupKeepsTurns(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, gerta := r.twoEncounters()
	ids := []int{participant(a, ulrich).ID, participant(a, gerta).ID}
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Ulrich"}}}
	a = r.must(r.encounters.Order(r.ctx, r.ref(a), map[int]int{groupOf(a, gerta): 0, a.Groups[0].ID: 1, groupOf(a, ulrich): 2}, view))
	r.must(r.encounters.Next(r.ctx, r.ref(a)))
	r.must(r.encounters.Next(r.ctx, r.ref(a)))
	a = r.must(r.encounters.Next(r.ctx, r.ref(a)))
	ulrichs := groupOf(a, ulrich)
	wantTurn(t, a, &ulrichs, 1)
	r.must(r.encounters.Order(r.ctx, r.ref(b), map[int]int{}, view))
	b = r.must(r.encounters.Next(r.ctx, r.ref(b)))
	theirs := b.Groups[0].ID
	wantTurn(t, b, &theirs, 1)

	// The heroes take Gerta's place in A, where she came first, and Ulrich's
	// turn; B has them unsorted, and its turn stays.
	states := r.all(r.encounters.Group(r.ctx, r.ref(a), ids, "Heroes"))
	a, b = of(states, a.ID), of(states, b.ID)
	heroes := groupOf(a, ulrich)
	wantTurn(t, a, &heroes, 1)
	wantTurn(t, b, &theirs, 1)
	if a.Groups[0].ID != heroes || deref(a.Groups[0].Position) != 0 || b.Groups[1].ID != heroes || b.Groups[1].Position != nil {
		t.Errorf("groups %+v and %+v", a.Groups, b.Groups)
	}
	if a.InitiativeView != nil || b.InitiativeView != nil {
		t.Errorf("views %+v and %+v, want none", a.InitiativeView, b.InitiativeView)
	}

	// Ulrich keeps the group and its turn; Gerta follows at its place.
	r.must(r.encounters.Order(r.ctx, r.ref(b), map[int]int{}, view))
	states = r.all(r.encounters.Ungroup(r.ctx, r.ref(b), heroes))
	a, b = of(states, a.ID), of(states, b.ID)
	wantTurn(t, a, &heroes, 1)
	wantTurn(t, b, &theirs, 1)
	own := groupOf(a, gerta)
	if groupOf(a, ulrich) != heroes || own == heroes || groupOf(b, gerta) != own || a.Groups[0].Name != nil {
		t.Errorf("groups %+v, participants %+v", a.Groups, a.Participants)
	}
	if a.Groups[1].ID != own || deref(a.Groups[1].Position) != 0 || b.InitiativeView != nil {
		t.Errorf("groups %+v, view %+v", a.Groups, b.InitiativeView)
	}
}

// Ulrich is removed while his group has the turn in A but not in B.
func TestRemovingCharacterPassesTurnWhereItWas(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, gerta := r.twoEncounters()
	r.must(r.encounters.Next(r.ctx, r.ref(a)))
	a = r.must(r.encounters.Next(r.ctx, r.ref(a)))
	ulrichs := groupOf(a, ulrich)
	wantTurn(t, a, &ulrichs, 1)
	b = r.must(r.encounters.Next(r.ctx, r.ref(b)))
	theirs := b.Groups[0].ID
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Ulrich"}}}
	r.must(r.encounters.Order(r.ctx, r.ref(a), map[int]int{}, view))
	r.must(r.encounters.Order(r.ctx, r.ref(b), map[int]int{}, view))

	if _, err := r.encounters.Remove(r.ctx, r.ref(a), []int{a.Participants[0].ID, participant(a, ulrich).ID}); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("an NPC and a character removed together: %v", err)
	}
	states := r.all(r.encounters.Remove(r.ctx, r.ref(b), []int{participant(a, ulrich).ID}))
	a, b = of(states, a.ID), of(states, b.ID)
	gertas := groupOf(a, gerta)
	wantTurn(t, a, &gertas, 1)
	wantTurn(t, b, &theirs, 1)
	for _, s := range states {
		if participant(s, ulrich) != nil || len(s.Groups) != 2 || s.InitiativeView != nil {
			t.Errorf("encounter %d: groups %+v, view %+v", s.ID, s.Groups, s.InitiativeView)
		}
	}
	// The sheet stays in the room.
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1`, ulrich); n != 1 {
		t.Errorf("the sheet of a removed character is gone")
	}
}

func TestPartyOutlivesEncounters(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, _ := r.twoEncounters()
	if _, err := r.encounters.Delete(r.ctx, r.ref(a)); err != nil {
		t.Fatal(err)
	}
	b = r.must(r.encounters.Get(r.ctx, r.gm, b.ID))
	if participant(b, ulrich) == nil || len(b.Groups) != 3 {
		t.Errorf("groups %+v, participants %+v", b.Groups, b.Participants)
	}
	if _, err := r.encounters.Delete(r.ctx, r.ref(b)); err != nil {
		t.Fatal(err)
	}
	c := r.create("Hive")
	if participant(c, ulrich) == nil || len(c.Participants) != 2 {
		t.Errorf("participants of a new encounter %+v", c.Participants)
	}
}

func TestDescribe(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	s = r.must(r.encounters.Describe(r.ctx, r.ref(s), strings.Repeat("я", maxEncounterNotes)))
	if utf8.RuneCountInString(s.Description) != maxEncounterNotes {
		t.Errorf("description of %d characters", utf8.RuneCountInString(s.Description))
	}
	if _, err := r.encounters.Describe(r.ctx, r.ref(s), strings.Repeat("я", maxEncounterNotes+1)); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("a description too long: %v", err)
	}
	ref := r.ref(s)
	ref.UserID = r.player
	if _, err := r.encounters.Describe(r.ctx, ref, "Mine"); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("a player described the encounter: %v", err)
	}
}

// A character is shown under one name in every encounter of the room.
func TestCharacterNameReachesEveryEncounter(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, _ := r.twoEncounters()
	states := r.all(r.encounters.SetDisplayName(r.ctx, r.ref(b), participant(b, ulrich).ID, "Stranger"))
	if len(states) != 2 {
		t.Fatalf("states %+v", states)
	}
	for _, s := range states {
		if p := participant(s, ulrich); deref2(p.DisplayName) != "Stranger" {
			t.Errorf("Ulrich in %d: %+v", s.ID, p)
		}
	}
	// The other encounter changed too: its gamemaster's tabs take the state.
	if v := of(states, a.ID).Version; v <= a.Version {
		t.Errorf("version of A %d, was %d", v, a.Version)
	}
	npc := a.Participants[0]
	if _, err := r.encounters.SetDisplayName(r.ctx, r.ref(b), npc.ID, "Shadow"); !errors.Is(err, ErrInvalidEncounterRequest) {
		t.Errorf("named an NPC of another encounter: %v", err)
	}
}

// A change of the party has the state of the encounter it was made in only,
// and the players' view of the shown encounter when it reached that one.
func TestPartyChangeOfEncounters(t *testing.T) {
	r := newEncounterRoom(t)
	a, b, ulrich, _ := r.twoEncounters()
	if _, err := r.encounters.Show(r.ctx, r.gm, r.room, &b.ID); err != nil {
		t.Fatal(err)
	}
	view := &InitiativeView{Round: 1, Rows: []InitiativeRow{{Name: "Ulrich"}}}
	r.must(r.encounters.Order(r.ctx, r.ref(b), map[int]int{}, view))

	// A name of a character keeps the view.
	c, err := r.encounters.SetDisplayName(r.ctx, r.ref(a), participant(a, ulrich).ID, "Stranger")
	if err != nil {
		t.Fatal(err)
	}
	if c.State == nil || c.State.ID != a.ID || len(c.Versions) != 2 {
		t.Fatalf("change %+v, want the state of A and two encounters", c)
	}
	if !c.Shown || !reflect.DeepEqual(c.ShownView, view) {
		t.Errorf("shown %v with view %+v, want B's", c.Shown, c.ShownView)
	}

	// A sheet added clears the view; a change that names no encounter has no state.
	c, err = r.encounters.PartyAdd(r.ctx, r.party(), []int{r.sheet(r.player, r.room, "Kayvaan")})
	if err != nil {
		t.Fatal(err)
	}
	if c.State != nil || len(c.Versions) != 2 || !c.Shown || c.ShownView != nil {
		t.Errorf("change %+v, want no state and no view", c)
	}

	// An NPC of A is of A only.
	npc := a.Participants[slices.IndexFunc(a.Participants, func(p EncounterParticipant) bool { return p.NPC })]
	c, err = r.encounters.Move(r.ctx, r.ref(a), npc.ID, SideParty)
	if err != nil {
		t.Fatal(err)
	}
	if c.State == nil || c.State.ID != a.ID || len(c.Versions) != 1 || c.Versions[0] != (EncounterVersion{a.ID, c.State.Version}) || c.Shown {
		t.Errorf("change %+v, want A only", c)
	}

	// The encounters a deleted sheet left are known by their ids.
	c, err = r.encounters.Changed(r.ctx, r.room, []int{b.ID, a.ID})
	if err != nil {
		t.Fatal(err)
	}
	states := r.all(c, nil)
	if c.State != nil || len(states) != 2 || states[0].ID != a.ID || !c.Shown {
		t.Errorf("change %+v, want A and B by id, B shown", c)
	}
}
