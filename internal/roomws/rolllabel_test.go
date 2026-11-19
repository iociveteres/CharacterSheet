package roomws

import (
	"encoding/json"
	"os"
	"testing"
)

// The examples are shared with the client's parseLabel
// (ui/static/js/sheet/rollLabelText.test.ts), so the two checks agree.
func TestValidLabelExamples(t *testing.T) {
	raw, err := os.ReadFile("testdata/roll_labels.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Why   string          `json:"why"`
		Valid bool            `json:"valid"`
		Label json.RawMessage `json:"label"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, e := range examples {
		if got := validLabel(e.Label); got != e.Valid {
			t.Errorf("%s: validLabel(%s) = %v, want %v", e.Why, e.Label, got, e.Valid)
		}
	}
}

func TestBodyWithoutLabel(t *testing.T) {
	for _, c := range []struct {
		body, want string
		cut        bool
	}{
		{"/r d100 vs 45\n>> Lasgun, full aim", "/r d100 vs 45", true},
		{"/roll 2d10+3 \n>> Bolter\n>> second line", "/roll 2d10+3", true},
		{"/r d100 vs 45", "/r d100 vs 45", false},
		{"/r d100 >> inline", "/r d100 >> inline", false},
		{"hello\n>> quote", "hello\n>> quote", false},
	} {
		if got, cut := bodyWithoutLabel(c.body); got != c.want || cut != c.cut {
			t.Errorf("bodyWithoutLabel(%q) = %q, %v; want %q, %v", c.body, got, cut, c.want, c.cut)
		}
	}
}
