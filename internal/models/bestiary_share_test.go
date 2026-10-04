package models

import (
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"
)

func (r *encounterRoom) visibility(user, collectionID int, v CollectionVisibility) *BestiaryCollection {
	r.t.Helper()
	c, err := r.bestiary().UpdateCollection(r.ctx, user, collectionID, CollectionEdit{Visibility: &v})
	if err != nil {
		r.t.Fatal(err)
	}
	return c
}

func (r *encounterRoom) subscribe(user, collectionID int) {
	r.t.Helper()
	if _, err := r.bestiary().Subscribe(r.ctx, user, collectionID); err != nil {
		r.t.Fatal(err)
	}
}

// listed is the names of the collections in the user's list, in its order.
func (r *encounterRoom) listed(user int) []string {
	r.t.Helper()
	b, err := r.bestiary().Get(r.ctx, user)
	if err != nil {
		r.t.Fatal(err)
	}
	out := []string{}
	for _, c := range b.Collections {
		out = append(out, c.Name)
	}
	return out
}

func TestVisibility(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.player, "Orks")
	if orks.Visibility != VisibilityPrivate || orks.PublishedAt != nil || !orks.Own || orks.Owner != "player" || orks.Default || orks.Subscribed {
		t.Errorf("new collection %+v", orks)
	}
	for _, v := range []CollectionVisibility{VisibilityPublic, VisibilityPrivate} {
		if c := r.visibility(r.player, orks.ID, v); c.Visibility != v {
			t.Errorf("%s: %+v", v, c)
		}
	}
	for _, bad := range []CollectionVisibility{"everyone", "link"} {
		if _, err := b.UpdateCollection(r.ctx, r.player, orks.ID, CollectionEdit{Visibility: &bad}); !errors.Is(err, ErrInvalidBestiaryRequest) {
			t.Errorf("visibility %q: %v", bad, err)
		}
	}
}

func TestPublishedAt(t *testing.T) {
	r := newEncounterRoom(t)
	orks := r.newCollection(r.player, "Orks")
	published := r.visibility(r.player, orks.ID, VisibilityPublic).PublishedAt
	if published == nil {
		t.Fatal("no publication date")
	}
	r.exec(`UPDATE bestiary_collections SET published_at = '2020-01-01' WHERE id = $1`, orks.ID)

	// Edits of a public collection do not publish it again.
	r.visibility(r.player, orks.ID, VisibilityPublic)
	if _, err := r.bestiary().UpdateCollection(r.ctx, r.player, orks.ID, CollectionEdit{Name: strp("Orks!")}); err != nil {
		t.Fatal(err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_collections WHERE id = $1 AND published_at = '2020-01-01'`, orks.ID); n != 1 {
		t.Error("an edit moved the publication date")
	}

	r.visibility(r.player, orks.ID, VisibilityPrivate)
	if c := r.visibility(r.player, orks.ID, VisibilityPublic); c.PublishedAt == nil || c.PublishedAt.Year() == 2020 {
		t.Errorf("published again at %v", c.PublishedAt)
	}
}

func TestSubscriptions(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks := r.newCollection(r.player, "Orks")
	boy := r.creature(r.player, orks.ID, "Ork Boy")
	viewable := func(user int) bool {
		r.t.Helper()
		var view bool
		if err := r.pool.QueryRow(r.ctx, `SELECT can_view_character_sheet($1, $2)`, user, boy).Scan(&view); err != nil {
			t.Fatal(err)
		}
		return view
	}
	all := func(user int) []string {
		t.Helper()
		got, err := b.Creatures(r.ctx, user, CreatureFilter{})
		if err != nil {
			t.Fatal(err)
		}
		return names(got)
	}

	if _, err := b.Collection(r.ctx, r.gm, orks.ID); !errors.Is(err, ErrNoRecord) {
		t.Errorf("opened a private collection: %v", err)
	}
	if _, err := b.Subscribe(r.ctx, r.gm, orks.ID); !errors.Is(err, ErrNoRecord) {
		t.Errorf("subscribed to a private collection: %v", err)
	}
	if _, err := b.Subscribe(r.ctx, r.player, orks.ID); !errors.Is(err, ErrInvalidBestiaryRequest) {
		t.Errorf("subscribed to an own collection: %v", err)
	}
	if c, err := b.Collection(r.ctx, r.player, orks.ID); err != nil || !c.Own {
		t.Errorf("own collection %+v, %v", c, err)
	}

	// Public, it opens without a subscription and writes nothing; the lists
	// take it only with one.
	r.visibility(r.player, orks.ID, VisibilityPublic)
	c, err := b.Collection(r.ctx, r.gm, orks.ID)
	if err != nil || c.Own || c.Owner != "player" || c.Subscribed || c.Creatures != 1 {
		t.Fatalf("opened %+v, %v", c, err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_subscriptions`); n != 0 {
		t.Errorf("opening made %d subscriptions", n)
	}
	if !viewable(r.gm) {
		t.Error("a public creature is hidden")
	}
	if got := r.listed(r.gm); len(got) != 0 {
		t.Errorf("listed %v without a subscription", got)
	}
	if got := all(r.gm); len(got) != 0 {
		t.Errorf("creatures %v without a subscription", got)
	}

	if c, err := b.Subscribe(r.ctx, r.gm, orks.ID); err != nil || !c.Subscribed {
		t.Fatalf("subscribed %+v, %v", c, err)
	}
	r.subscribe(r.gm, orks.ID)
	if got := r.listed(r.gm); !slices.Equal(got, []string{"Orks"}) {
		t.Errorf("listed %v", got)
	}
	if got := all(r.gm); !slices.Equal(got, []string{"Ork Boy"}) {
		t.Errorf("creatures %v", got)
	}

	// Private, the subscription stays and shows nothing; public again, it is
	// back.
	r.visibility(r.player, orks.ID, VisibilityPrivate)
	if got := r.listed(r.gm); len(got) != 0 {
		t.Errorf("a private collection listed: %v", got)
	}
	if got := all(r.gm); len(got) != 0 {
		t.Errorf("creatures %v of a private collection", got)
	}
	if viewable(r.gm) {
		t.Error("a subscription opened a private creature")
	}
	if _, err := b.Collection(r.ctx, r.gm, orks.ID); !errors.Is(err, ErrNoRecord) {
		t.Errorf("opened a private collection with a subscription: %v", err)
	}
	if n := r.count(`SELECT count(*) FROM bestiary_subscriptions WHERE user_id = $1`, r.gm); n != 1 {
		t.Errorf("%d subscriptions", n)
	}
	r.visibility(r.player, orks.ID, VisibilityPublic)
	if got := r.listed(r.gm); !slices.Equal(got, []string{"Orks"}) {
		t.Errorf("listed %v after going public again", got)
	}

	if err := b.Unsubscribe(r.ctx, r.gm, orks.ID); err != nil {
		t.Fatal(err)
	}
	if got := r.listed(r.gm); len(got) != 0 {
		t.Errorf("unsubscribed, still lists %v", got)
	}
}

func TestSharedCollectionsList(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	r.newCollection(r.gm, "Mine")
	older := r.newCollection(r.gm, "Older")
	r.exec(`UPDATE bestiary_collections SET updated_at = now() - interval '1 day' WHERE id = $1`, older.ID)
	r.exec(`INSERT INTO bestiary_collections (owner_id, name, is_default, updated_at) VALUES ($1, 'My creatures', true, now() - interval '2 days')`, r.gm)
	public, earlier := r.newCollection(r.player, "Public"), r.newCollection(r.player, "Earlier")
	r.newCollection(r.player, "Private")
	r.visibility(r.player, public.ID, VisibilityPublic)
	r.visibility(r.player, earlier.ID, VisibilityPublic)
	r.subscribe(r.gm, earlier.ID)
	r.subscribe(r.gm, public.ID)
	r.exec(`UPDATE bestiary_subscriptions SET subscribed_at = now() - interval '1 hour' WHERE collection_id = $1`, earlier.ID)

	got, err := b.Get(r.ctx, r.gm)
	if err != nil {
		t.Fatal(err)
	}
	var rows []string
	for _, c := range got.Collections {
		rows = append(rows, fmt.Sprintf("%s %v %v %v %s %s", c.Name, c.Own, c.Default, c.Subscribed, c.Visibility, c.Owner))
	}
	// Own, the default first, then the last changed first; then the
	// subscriptions, the last made first.
	want := []string{
		"My creatures true true false private gm",
		"Mine true false false private gm",
		"Older true false false private gm",
		"Public false false true public player",
		"Earlier false false true public player",
	}
	if !slices.Equal(rows, want) {
		t.Errorf("collections\n%v\nwant\n%v", rows, want)
	}
}

func TestCatalog(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	for i := range catalogPage + 2 {
		c := r.newCollection(r.player, fmt.Sprintf("Horde %02d", i))
		r.visibility(r.player, c.ID, VisibilityPublic)
		r.exec(`UPDATE bestiary_collections SET published_at = '2026-01-01'::timestamptz + $2 * interval '1 day' WHERE id = $1`, c.ID, i)
	}
	cult := r.newCollection(r.gm, "Cult 100%")
	r.creature(r.gm, cult.ID, "Cultist")
	if _, err := b.UpdateCollection(r.ctx, r.gm, cult.ID, CollectionEdit{Tags: &[]string{"chaos"}}); err != nil {
		t.Fatal(err)
	}
	r.visibility(r.gm, cult.ID, VisibilityPublic)
	r.newCollection(r.player, "Private")

	page, err := b.Catalog(r.ctx, r.outsider, CatalogFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != catalogPage || page.Next == nil || page.Rows[0].Name != "Cult 100%" || page.Rows[1].Name != "Horde 51" {
		t.Fatalf("first page: %d rows, next %v, first %+v", len(page.Rows), page.Next, page.Rows[0])
	}
	// A collection published before the next page does not repeat a row.
	r.visibility(r.player, r.newCollection(r.player, "Horde late").ID, VisibilityPublic)
	after, err := ParseCatalogCursor(*page.Next)
	if err != nil {
		t.Fatal(err)
	}
	page, _ = b.Catalog(r.ctx, r.outsider, CatalogFilter{After: after})
	var rest []string
	for _, c := range page.Rows {
		rest = append(rest, c.Name)
	}
	if !slices.Equal(rest, []string{"Horde 02", "Horde 01", "Horde 00"}) || page.Next != nil {
		t.Errorf("second page %v, next %v", rest, page.Next)
	}
	page, _ = b.Catalog(r.ctx, r.outsider, CatalogFilter{Oldest: true, After: &CatalogCursor{PublishedAt: time.Date(2026, 1, 50, 0, 0, 0, 0, time.UTC), ID: 1 << 30}})
	// Then the two published now.
	if len(page.Rows) != 4 || page.Rows[0].Name != "Horde 50" || page.Rows[1].Name != "Horde 51" {
		t.Errorf("oldest after Horde 49: %+v", page.Rows)
	}

	page, _ = b.Catalog(r.ctx, r.outsider, CatalogFilter{Oldest: true})
	if page.Rows[0].Name != "Horde 00" {
		t.Errorf("oldest first: %s", page.Rows[0].Name)
	}
	for _, f := range []CatalogFilter{{Query: "0%"}, {Tag: "chaos"}} {
		page, _ = b.Catalog(r.ctx, r.gm, f)
		if len(page.Rows) != 1 || page.Rows[0].Name != "Cult 100%" {
			t.Errorf("%+v: %+v", f, page.Rows)
			continue
		}
		if c := page.Rows[0]; !c.Own || c.Owner != "gm" || c.Creatures != 1 || !slices.Equal(c.Tags, []string{"chaos"}) {
			t.Errorf("row %+v", c)
		}
	}
	if page, _ = b.Catalog(r.ctx, r.outsider, CatalogFilter{Query: "private"}); len(page.Rows) != 0 {
		t.Errorf("a private collection in the catalog: %+v", page.Rows)
	}
}

func TestTagSuggestionsSkipPrivate(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	public, private := r.newCollection(r.player, "Public"), r.newCollection(r.player, "Private")
	for c, tag := range map[int]string{public.ID: "open", private.ID: "secret"} {
		if _, err := b.UpdateCollection(r.ctx, r.player, c, CollectionEdit{Tags: &[]string{tag}}); err != nil {
			t.Fatal(err)
		}
		r.exec(`UPDATE character_sheets SET tags = $2 WHERE id = $1`, r.creature(r.player, c, "Grot"), []string{tag + "-creature"})
	}
	r.visibility(r.player, public.ID, VisibilityPublic)

	got, err := b.Get(r.ctx, r.gm)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Tags.Collections, []string{"open"}) || !slices.Equal(got.Tags.Creatures, []string{"open-creature"}) {
		t.Errorf("suggested %+v", got.Tags)
	}
}

func TestTagSuggestions(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	tag := func(user int, name string, tags []string, changed string) {
		c := r.newCollection(user, name)
		r.exec(`UPDATE bestiary_collections SET tags = $2 WHERE id = $1`, c.ID, tags)
		r.creature(user, c.ID, "Grot")
		r.exec(`UPDATE bestiary_collections SET updated_at = $2 WHERE id = $1`, c.ID, changed)
		r.exec(`UPDATE character_sheets SET tags = $2, updated_at = $3 WHERE collection_id = $1`, c.ID, tags, changed)
	}
	// The gamemaster's tags, the last used first: twelve, of which ten show.
	for i := range 12 {
		tag(r.gm, fmt.Sprintf("Mine %d", i), []string{fmt.Sprintf("own%02d", i)}, fmt.Sprintf("2026-01-%02d", i+1))
	}
	// Public tags, the most used first, without those the user has.
	tag(r.player, "Orks", []string{"orks", "OWN11"}, "2026-02-01")
	tag(r.player, "More orks", []string{"orks", "green"}, "2026-02-01")
	r.visibility(r.player, r.newCollection(r.player, "Empty").ID, VisibilityPublic)
	for _, c := range []string{"Orks", "More orks"} {
		r.exec(`UPDATE bestiary_collections SET visibility = 'public' WHERE name = $1`, c)
	}

	got, err := b.Get(r.ctx, r.gm)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"own11", "own10", "own09", "own08", "own07", "own06", "own05", "own04", "own03", "own02", "orks", "green"}
	if !slices.Equal(got.Tags.Collections, want) || !slices.Equal(got.Tags.Creatures, want) {
		t.Errorf("suggested %v and %v, want %v", got.Tags.Collections, got.Tags.Creatures, want)
	}
}

func TestCopySharedCreature(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	orks, followed, private := r.newCollection(r.player, "Orks"), r.newCollection(r.player, "Followed"), r.newCollection(r.player, "Secret")
	boy, nob, grot := r.creature(r.player, orks.ID, "Ork Boy"), r.creature(r.player, followed.ID, "Ork Nob"), r.creature(r.player, private.ID, "Grot")
	r.exec(`UPDATE character_sheets SET tags = '{infantry}' WHERE id = $1`, boy)
	r.visibility(r.player, orks.ID, VisibilityPublic)
	r.visibility(r.player, followed.ID, VisibilityPublic)
	r.subscribe(r.gm, followed.ID)
	mine := r.newCollection(r.gm, "Mine")

	// A public collection reads without a subscription; all the collections
	// are only those in the list.
	got, err := b.Creatures(r.ctx, r.gm, CreatureFilter{CollectionID: &orks.ID})
	if err != nil || !slices.Equal(names(got), []string{"Ork Boy"}) {
		t.Errorf("public collection: %v, %v", names(got), err)
	}
	if got, _ = b.Creatures(r.ctx, r.gm, CreatureFilter{}); !slices.Equal(names(got), []string{"Ork Nob"}) {
		t.Errorf("all listed: %v", names(got))
	}
	if _, err := b.Creatures(r.ctx, r.gm, CreatureFilter{CollectionID: &private.ID}); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a private collection: %v", err)
	}

	copied, err := b.CopyCreature(r.ctx, r.gm, boy, into(mine.ID))
	if err != nil {
		t.Fatal(err)
	}
	if copied.CollectionID != mine.ID || deref2(copied.SourceLabel) != "Orks · player" || !slices.Equal(copied.Tags, []string{"infantry"}) {
		t.Errorf("copy %+v", copied)
	}
	if c, err := b.CopyCreature(r.ctx, r.gm, nob, into(mine.ID)); err != nil || deref2(c.SourceLabel) != "Followed · player" {
		t.Errorf("copy of a subscription: %+v, %v", c, err)
	}
	// A copy of the copy keeps where it came from.
	if c, err := b.CopyCreature(r.ctx, r.gm, copied.ID, into(mine.ID)); err != nil || deref2(c.SourceLabel) != "Orks · player" {
		t.Errorf("copy of the copy: %+v, %v", c, err)
	}
	// The owner's own copies have no source.
	if c, err := b.CopyCreature(r.ctx, r.player, boy, into(private.ID)); err != nil || c.SourceLabel != nil {
		t.Errorf("the owner's copy: %+v, %v", c, err)
	}

	if _, err := b.CopyCreature(r.ctx, r.gm, grot, into(mine.ID)); !errors.Is(err, ErrNoRecord) {
		t.Errorf("copied a private creature: %v", err)
	}
	if _, err := b.CopyCreature(r.ctx, r.gm, boy, into(orks.ID)); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("copied into a public collection of another user: %v", err)
	}
	// Seen, still not the gamemaster's.
	if _, err := b.UpdateCreature(r.ctx, r.gm, boy, CreatureEdit{Name: strp("Mine")}); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("renamed a public creature: %v", err)
	}
	if _, err := b.Export(r.ctx, r.gm, orks.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("exported a public collection of another user: %v", err)
	}
}

func TestAddSharedCreature(t *testing.T) {
	r := newEncounterRoom(t)
	orks := r.newCollection(r.player, "Orks")
	boy := r.creature(r.player, orks.ID, "Ork Boy")
	r.visibility(r.player, orks.ID, VisibilityPublic)

	s := r.must(r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), boy, 2))
	for i, p := range s.Participants {
		if p.Name != fmt.Sprintf("Ork Boy %d", i+1) || !p.NPC || p.SourceCreatureID != nil || deref2(p.SourceLabel) != "Orks · player" {
			t.Errorf("participant %+v", p)
		}
	}

	// A character has no source label, nor a new NPC.
	s = r.must(r.encounters.NewNpc(r.ctx, r.ref(s), KindBlackCrusade))
	s = r.must(r.encounters.AddSheets(r.ctx, r.ref(s), []int{r.sheet(r.player, r.room, "Ulrich")}))
	for _, p := range s.Participants[2:] {
		if p.SourceLabel != nil {
			t.Errorf("participant %+v has a source", p)
		}
	}

	r.visibility(r.player, orks.ID, VisibilityPrivate)
	if _, err := r.encounters.AddCreature(r.ctx, r.ref(s), boy, 1); !errors.Is(err, ErrNoRecord) {
		t.Errorf("added a private creature: %v", err)
	}
}
