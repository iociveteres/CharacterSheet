package main

import (
	"encoding/json"
	"reflect"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// The stress encounter loads as it is: ParseEncounterFile, which brings each
// NPC to the current shape, leaves the creatures unchanged, and they are
// valid sheets.
func TestStressEncounterNeedsNoUpgrade(t *testing.T) {
	file := stressEncounterFile()
	data, err := json.Marshal(file)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := models.ParseEncounterFile(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Npcs) < 20 || len(parsed.Groups) != len(stressSquads) {
		t.Fatalf("%d NPCs in %d groups", len(parsed.Npcs), len(parsed.Groups))
	}
	for i, npc := range parsed.Npcs {
		if err := models.ValidateCharacterSheetJSON(file.Npcs[i].Content); err != nil {
			t.Fatalf("NPC %d: %v", i, err)
		}
		var before, after map[string]any
		if err := json.Unmarshal(file.Npcs[i].Content, &before); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(npc.Content, &after); err != nil {
			t.Fatal(err)
		}
		for key := range after {
			if !reflect.DeepEqual(before[key], after[key]) {
				t.Errorf("NPC %d: the current shape changes %s", i, key)
			}
		}
	}
}

// The scenario of scripts/perf/stress-scenarios.mjs picks the first ork by its name.
func TestStressEncounterHasPickedCreature(t *testing.T) {
	for _, npc := range stressEncounterFile().Npcs {
		var sheet models.CharacterSheetContent
		if err := json.Unmarshal(npc.Content, &sheet); err != nil {
			t.Fatal(err)
		}
		if sheet.CharacterInfo.CharacterName == "Stress Ork 01" {
			return
		}
	}
	t.Error("no Stress Ork 01")
}
