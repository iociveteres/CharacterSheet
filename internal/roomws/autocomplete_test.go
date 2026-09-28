package roomws

import (
	"encoding/json"
	"testing"

	"charactersheet.iociveteres.net/internal/gamedata"
)

func TestOverlayObject(t *testing.T) {
	tests := []struct {
		name, base, top, want string
		wantErr               bool
	}{
		{
			name: "entry fields win, the rest comes from the base",
			base: `{"stacks":1,"enabled":true,"name":"old"}`,
			top:  `{"name":"Stunned","entries":{"items":{"e1":{"type":"char_bonus"}}}}`,
			want: `{"enabled":true,"entries":{"items":{"e1":{"type":"char_bonus"}}},"name":"Stunned","stacks":1}`,
		},
		{name: "null base", base: `null`, top: `{"name":"A"}`, want: `{"name":"A"}`},
		{name: "base is not an object", base: `[1]`, top: `{}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := overlayObject(json.RawMessage(tt.base), json.RawMessage(tt.top))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %s", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tt.want {
				t.Errorf("got %s, want %s", got, tt.want)
			}
		})
	}
}

func TestConditionsCollection(t *testing.T) {
	idx, err := gamedata.NewIndex[gamedata.Condition]([]json.RawMessage{
		json.RawMessage(`{"name":"Blinded","name_ru":"Ослепление","conditions":[{"type":"RollBonus","name":"BS","value":"-30"}]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := NewServer(&Dependencies{Gamedata: &gamedata.Catalog{Conditions: idx}})

	got, err := app.searchCollection("conditions", "ослеп")
	if err != nil {
		t.Fatal(err)
	}
	if want := `[{"name":"Blinded","name_ru":"Ослепление"}]`; string(got) != want {
		t.Errorf("search got %s, want %s", got, want)
	}

	changes, ok := app.getClientJSON("conditions", "Blinded")
	if !ok {
		t.Fatal("Blinded not found")
	}
	var cond struct {
		Name    string `json:"name"`
		Entries struct {
			Items map[string]struct {
				Type      string `json:"type"`
				RollBonus string `json:"rollBonus"`
			} `json:"items"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(changes, &cond); err != nil {
		t.Fatal(err)
	}
	if cond.Name != "Blinded" || len(cond.Entries.Items) != 1 {
		t.Errorf("apply got %s", changes)
	}
	for _, e := range cond.Entries.Items {
		if e.Type != "roll_bonus" || e.RollBonus != "-30" {
			t.Errorf("entry %+v", e)
		}
	}
}

// Without conditions.json the collection is empty, as for the other ones.
func TestConditionsCollectionWithoutAsset(t *testing.T) {
	app := NewServer(&Dependencies{Gamedata: &gamedata.Catalog{}})
	got, err := app.searchCollection("conditions", "Blinded")
	if err != nil || string(got) != "[]" {
		t.Errorf("search got %s, %v", got, err)
	}
	if _, ok := app.getClientJSON("conditions", "Blinded"); ok {
		t.Error("apply found an entry")
	}
	if _, ok := app.getClientJSON("gear", "Rope"); ok {
		t.Error("apply found gear")
	}
}
