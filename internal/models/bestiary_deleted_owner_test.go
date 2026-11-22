package models

import (
	"errors"
	"testing"
)

// A public collection with subscribers outlives its owner's account (_prd/account_deletion/plan.md,
// 4.1): the owner is a tombstone with an empty name, which the client words. The collection reads
// as another user's, nobody edits it, and a copy of its creature names the collection alone.
func TestCollectionOfDeletedOwner(t *testing.T) {
	r := newEncounterRoom(t)
	b := r.bestiary()
	horde := r.newCollection(r.outsider, "Horde")
	boy := r.creature(r.outsider, horde.ID, "Ork Boy")
	r.visibility(r.outsider, horde.ID, VisibilityPublic)
	r.subscribe(r.gm, horde.ID)
	mine := r.newCollection(r.gm, "Mine")
	// What the wipe leaves of the owner and their creatures.
	r.exec(`UPDATE users SET name = '', status = 'deleted' WHERE id = $1`, r.outsider)
	r.exec(`UPDATE character_sheets SET author_id = NULL WHERE author_id = $1`, r.outsider)

	page, err := b.Catalog(r.ctx, r.gm, CatalogFilter{Query: "Horde"})
	if err != nil || len(page.Rows) != 1 {
		t.Fatalf("catalog %+v, %v", page, err)
	}
	if c := page.Rows[0]; c.Own || c.Owner != "" || c.Creatures != 1 {
		t.Errorf("catalog row %+v", c)
	}
	c, err := b.Collection(r.ctx, r.gm, horde.ID)
	if err != nil || c.Own || c.Owner != "" || !c.Subscribed {
		t.Errorf("collection %+v, %v", c, err)
	}
	list, err := b.Get(r.ctx, r.gm)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range list.Collections {
		if c.ID == horde.ID {
			found = true
			if c.Own || c.Owner != "" {
				t.Errorf("listed %+v", c)
			}
		}
	}
	if !found {
		t.Error("the subscription left the list")
	}

	name := "Mine now"
	if _, err := b.UpdateCollection(r.ctx, r.gm, horde.ID, CollectionEdit{Name: &name}); !errors.Is(err, ErrCollectionNotOwn) {
		t.Errorf("renamed the collection of a deleted owner: %v", err)
	}
	if err := b.DeleteCreature(r.ctx, r.gm, boy); !errors.Is(err, ErrCreatureNotOwn) {
		t.Errorf("deleted a creature of a deleted owner: %v", err)
	}

	copied, err := b.CopyCreature(r.ctx, r.gm, boy, into(mine.ID))
	if err != nil {
		t.Fatal(err)
	}
	if deref2(copied.SourceLabel) != "Horde" || copied.Author != nil {
		t.Errorf("copy %+v", copied)
	}
}
