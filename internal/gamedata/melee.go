package gamedata

import (
	"crypto/rand"
	"encoding/json"
	"strings"

	"charactersheet.iociveteres.net/internal/models"
)

// nanoidAlphabet is 64 chars so a single byte & 63 gives an unbiased index.
const nanoidAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-"

func newNanoid() string {
	b := make([]byte, 21)
	rb := make([]byte, 21)
	_, _ = rand.Read(rb)
	for i, v := range rb {
		b[i] = nanoidAlphabet[v&63]
	}
	return string(b)
}

// meleeProfileRaw mirrors the "profiles" array entries in the asset JSON.
type meleeProfileRaw struct {
	Profile    string `json:"profile"`
	Range      string `json:"range"`
	Damage     string `json:"damage"`
	DamageType string `json:"damageType"`
	Pen        string `json:"pen"`
	Special    string `json:"special"`
}

// meleeEntryRaw is used only for parsing the asset JSON during transformation.
type meleeEntryRaw struct {
	Name     string            `json:"name"`
	Group    string            `json:"group"`
	Grip     string            `json:"grip"`
	Balance  string            `json:"balance"`
	Profiles []meleeProfileRaw `json:"tabs"`
	Shield   models.Shield     `json:"shield"`
}

type Melee struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

// ClientJSON overrides CollectionEntry.ClientJSON to transform the asset shape
// ("profiles" array) into the DB/client shape ("tabs.items" object with nanoid keys).
// Called once per autocompleteApply, so UUIDs are always fresh.
func (m *Melee) ClientJSON() json.RawMessage {
	raw := m.CollectionEntry.ClientJSON()

	var entry meleeEntryRaw
	if err := json.Unmarshal(raw, &entry); err != nil {
		return raw // fall back to raw if parsing fails
	}

	type tabShape struct {
		meleeProfileRaw
		DamageMods models.ItemGrid[models.WeaponMod] `json:"damageMods"`
	}
	type tabsShape struct {
		Items map[string]tabShape `json:"items"`
	}

	tabItems := make(map[string]tabShape, len(entry.Profiles))
	for _, p := range entry.Profiles {
		tabItems["tab-"+newNanoid()] = tabShape{p, strengthBonus()}
	}

	out := map[string]any{
		"name":    entry.Name,
		"group":   strings.ToLower(entry.Group),
		"grip":    entry.Grip,
		"balance": entry.Balance,
		"tabs":    tabsShape{Items: tabItems},
		"shield":  entry.Shield,
	}

	b, err := json.Marshal(out)
	if err != nil {
		return raw
	}
	return b
}

type MeleeIndex = Index[Melee, *Melee]

// strengthBonus is the damage modifier of a melee profile picked from the
// collection, whose damage leaves out the Strength bonus that melee adds, as
// newMeleeAttack in ui/static/js/sheet/blocks/Attacks.tsx gives a new one.
func strengthBonus() models.ItemGrid[models.WeaponMod] {
	id := "damage-mod-" + newNanoid()
	return models.ItemGrid[models.WeaponMod]{
		Items:   map[string]models.WeaponMod{id: {Expr: "S.b", Enabled: true}},
		Layouts: map[string]models.Position{id: {}},
	}
}
