package gamedata

import (
	"crypto/rand"
	"encoding/json"
	"strconv"
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
	// Trait is the traits.json name of the trait whose profile the entry is,
	// "Natural Weapons (X)" or "Deadly Natural Weapons (X)"; empty for a
	// weapon. Search results carry it so the sheet knows which picks take X.
	Trait string `json:"trait,omitempty"`
}

// ClientJSON overrides CollectionEntry.ClientJSON to transform the asset shape
// ("profiles" array) into the DB/client shape ("tabs.items" object with nanoid keys).
// Called once per autocompleteApply, so UUIDs are always fresh.
func (m *Melee) ClientJSON() json.RawMessage {
	return m.RatedJSON("")
}

// RatedJSON is ClientJSON with the rating X of the entry's trait put into each
// profile as a damage modifier, and a Pen one for Deadly Natural Weapons:
// enabled when rating is a number, off when it is not (the sheet sends "X"
// when it has no such trait). An empty rating or an entry without a trait
// gets none: the asset's damage leaves X out.
func (m *Melee) RatedJSON(rating string) json.RawMessage {
	raw := m.CollectionEntry.ClientJSON()

	var entry meleeEntryRaw
	if err := json.Unmarshal(raw, &entry); err != nil {
		return raw // fall back to raw if parsing fails
	}

	type tabShape struct {
		meleeProfileRaw
		DamageMods models.ItemGrid[models.WeaponMod]  `json:"damageMods"`
		PenMods    *models.ItemGrid[models.WeaponMod] `json:"penMods,omitempty"`
	}
	type tabsShape struct {
		Items map[string]tabShape `json:"items"`
	}

	var x []models.WeaponMod
	if m.Trait != "" && rating != "" {
		_, err := strconv.Atoi(rating)
		x = []models.WeaponMod{{Expr: rating, Enabled: err == nil}}
	}
	deadly := strings.HasPrefix(m.Trait, "Deadly")

	tabItems := make(map[string]tabShape, len(entry.Profiles))
	for _, p := range entry.Profiles {
		tab := tabShape{meleeProfileRaw: p, DamageMods: modGrid("damage", append([]models.WeaponMod{strengthBonus}, x...))}
		if deadly && x != nil {
			pen := modGrid("pen", x)
			tab.PenMods = &pen
		}
		tabItems["tab-"+newNanoid()] = tab
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
var strengthBonus = models.WeaponMod{Expr: "S.b", Enabled: true}

// modGrid is a grid of mods of stat ("damage", "pen") under new ids, one per row.
func modGrid(stat string, mods []models.WeaponMod) models.ItemGrid[models.WeaponMod] {
	g := models.ItemGrid[models.WeaponMod]{
		Items:   make(map[string]models.WeaponMod, len(mods)),
		Layouts: make(map[string]models.Position, len(mods)),
	}
	for i, mod := range mods {
		id := stat + "-mod-" + newNanoid()
		g.Items[id] = mod
		g.Layouts[id] = models.Position{RowIndex: i}
	}
	return g
}
