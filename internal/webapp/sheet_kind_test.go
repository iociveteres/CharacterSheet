package webapp

import (
	"encoding/json"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
)

func TestContentWithSheetKind(t *testing.T) {
	content := json.RawMessage(`{"characterInfo":{"characterName":"Test Character"}}`)

	exported, err := contentWithSheetKind(content, models.KindPathfinderCrusade)
	if err != nil {
		t.Fatal(err)
	}

	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(exported, &fields); err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, string(fields[sheetKindJSONField]), `"pathfinder_crusade"`)
	assert.Equal(t, string(fields["characterInfo"]), `{"characterName":"Test Character"}`)
}

func TestContentWithoutSheetKind(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		wantKind  models.SheetKind
		wantError bool
	}{
		{
			name:     "Declared kind",
			content:  `{"sheetKind":"pathfinder_crusade","characterInfo":{"characterName":"Test"}}`,
			wantKind: models.KindPathfinderCrusade,
		},
		{
			name:     "File exported before kinds existed",
			content:  `{"characterInfo":{"characterName":"Test"}}`,
			wantKind: models.DefaultSheetKind,
		},
		{
			name:      "Unknown kind",
			content:   `{"sheetKind":"great_crusade"}`,
			wantError: true,
		},
		{
			name:      "Kind is not a string",
			content:   `{"sheetKind":42}`,
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stripped, kind, err := contentWithoutSheetKind([]byte(tt.content))
			if tt.wantError {
				if err == nil {
					t.Fatalf("got nil error for %s", tt.content)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}

			assert.Equal(t, kind, tt.wantKind)

			fields := map[string]json.RawMessage{}
			if err := json.Unmarshal(stripped, &fields); err != nil {
				t.Fatal(err)
			}
			if _, ok := fields[sheetKindJSONField]; ok {
				t.Error("stored content still carries the sheet kind")
			}
		})
	}
}

// A round trip must preserve the kind.
func TestSheetKindRoundTrip(t *testing.T) {
	content := json.RawMessage(`{
		"characterInfo": {"characterName": "Test Character"},
		"characteristics": {},
		"skillsLeft": {},
		"skillsRight": {}
	}`)

	exported, err := contentWithSheetKind(content, models.KindPathfinderCrusade)
	if err != nil {
		t.Fatal(err)
	}

	imported, kind, err := contentWithoutSheetKind(exported)
	if err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, kind, models.KindPathfinderCrusade)
	if err := models.ValidateCharacterSheetJSON(imported); err != nil {
		t.Fatalf("imported content is not a valid sheet: %v", err)
	}
}
