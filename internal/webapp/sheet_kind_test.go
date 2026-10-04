package webapp

import (
	"encoding/json"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
)

func TestContentWithSheetKind(t *testing.T) {
	content := json.RawMessage(`{"characterInfo":{"characterName":"Test Character"}}`)

	author := "alex"
	exported, err := sheetFile(content, models.KindPathfinderCrusade, &author)
	if err != nil {
		t.Fatal(err)
	}

	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(exported, &fields); err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, string(fields[sheetKindJSONField]), `"pathfinder_crusade"`)
	assert.Equal(t, string(fields[authorJSONField]), `"alex"`)
	assert.Equal(t, string(fields["characterInfo"]), `{"characterName":"Test Character"}`)

	// A sheet whose author is unknown names none.
	if exported, err = sheetFile(content, models.KindPathfinderCrusade, nil); err != nil {
		t.Fatal(err)
	}
	fields = map[string]json.RawMessage{}
	if err := json.Unmarshal(exported, &fields); err != nil {
		t.Fatal(err)
	}
	if _, ok := fields[authorJSONField]; ok {
		t.Error("an unknown author is in the file")
	}
}

func TestContentWithoutSheetKind(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantKind   models.SheetKind
		wantAuthor string
		wantError  bool
	}{
		{
			name:     "Declared kind",
			content:  `{"sheetKind":"pathfinder_crusade","characterInfo":{"characterName":"Test"}}`,
			wantKind: models.KindPathfinderCrusade,
		},
		{
			name:       "Named author",
			content:    `{"sheetKind":"pathfinder_crusade","author":"alex","characterInfo":{"characterName":"Test"}}`,
			wantKind:   models.KindPathfinderCrusade,
			wantAuthor: "alex",
		},
		{
			name:       "Author without a kind",
			content:    `{"author":"alex","characterInfo":{"characterName":"Test"}}`,
			wantKind:   models.DefaultSheetKind,
			wantAuthor: "alex",
		},
		{
			name:      "Author is not a string",
			content:   `{"author":42}`,
			wantError: true,
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
			stripped, kind, author, err := sheetOfFile([]byte(tt.content))
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
			if (author == nil) != (tt.wantAuthor == "") || author != nil && *author != tt.wantAuthor {
				t.Errorf("author %v, want %q", author, tt.wantAuthor)
			}

			fields := map[string]json.RawMessage{}
			if err := json.Unmarshal(stripped, &fields); err != nil {
				t.Fatal(err)
			}
			if _, ok := fields[sheetKindJSONField]; ok {
				t.Error("stored content still carries the sheet kind")
			}
			if _, ok := fields[authorJSONField]; ok {
				t.Error("stored content still carries the author")
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

	exported, err := sheetFile(content, models.KindPathfinderCrusade, nil)
	if err != nil {
		t.Fatal(err)
	}

	imported, kind, _, err := sheetOfFile(exported)
	if err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, kind, models.KindPathfinderCrusade)
	if err := models.ValidateCharacterSheetJSON(imported); err != nil {
		t.Fatalf("imported content is not a valid sheet: %v", err)
	}
}
