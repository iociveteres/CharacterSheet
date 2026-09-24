package models

import (
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestSheetKindIsValid(t *testing.T) {
	tests := []struct {
		name string
		kind SheetKind
		want bool
	}{
		{name: "Black Crusade", kind: KindBlackCrusade, want: true},
		{name: "Pathfinder Crusade", kind: KindPathfinderCrusade, want: true},
		{name: "Unknown", kind: SheetKind("great_crusade"), want: false},
		{name: "Empty", kind: SheetKind(""), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.kind.IsValid(), tt.want)
		})
	}
}

func TestParseSheetKind(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		want      SheetKind
		wantError bool
	}{
		{name: "Known kind", value: "pathfinder_crusade", want: KindPathfinderCrusade},
		{name: "Empty means default", value: "", want: DefaultSheetKind},
		{name: "Unknown kind", value: "great_crusade", wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kind, err := ParseSheetKind(tt.value)
			if tt.wantError {
				if err == nil {
					t.Fatalf("got nil error for %q", tt.value)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			assert.Equal(t, kind, tt.want)
		})
	}
}

func TestSheetKindsHaveLabels(t *testing.T) {
	for _, info := range SheetKinds() {
		if !info.Kind.IsValid() {
			t.Errorf("kind %q is not valid", info.Kind)
		}
		if info.Label == "" {
			t.Errorf("kind %q has no label", info.Kind)
		}
	}
}
