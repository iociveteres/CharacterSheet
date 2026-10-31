package roomws

import (
	"context"
	"testing"
)

// A new portrait reaches those who view the sheet, every tab of the user who
// changed it included: the HTTP request answers with no hash.
func TestPortraitChangeReachesViewers(t *testing.T) {
	room := newAudienceRoom(t)
	gm, owner, player := room.dial(gmID), room.dial(ownerID), room.dial(playerID)

	hash := "0123456789abcdef"
	room.server.PortraitChanged(context.Background(), 10, &hash)
	room.mark()
	for _, p := range []*peer{gm, owner} {
		if msg := p.expect("portraitChanged", ""); msg["sheetID"] != "10" || msg["portrait"] != hash {
			t.Errorf("got %v", msg)
		}
		p.expect("marker", "")
	}
	// Sheet 10 is hidden from players.
	player.expect("marker", "")

	room.server.PortraitChanged(context.Background(), 10, nil)
	if msg := owner.expect("portraitChanged", ""); msg["portrait"] != nil {
		t.Errorf("a deleted portrait: %v", msg)
	}
}

// A creature's portrait goes to the bestiary tabs of its collection's owner.
func TestCreaturePortraitReachesBestiary(t *testing.T) {
	pages := newBestiaryPages(t)
	owner := pages.dial(ownerID)

	hash := "0123456789abcdef"
	pages.server.PortraitChanged(context.Background(), 40, &hash)
	if msg := owner.expect("portraitChanged", ""); msg["sheetID"] != "40" || msg["portrait"] != hash {
		t.Errorf("got %v", msg)
	}

	// The owner of creature 50 has no bestiary tab open: no hub is made.
	pages.server.PortraitChanged(context.Background(), 50, &hash)
	if pages.server.bestiaryHub(playerID) != nil {
		t.Error("a portrait change made a bestiary hub")
	}
}
