package models

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

func dots(dotted string) []string { return ParseJSONBPath(dotted) }

func TestCheckSheetPath(t *testing.T) {
	good := []struct {
		path string
		kind reflect.Kind
	}{
		{"characterInfo.characterName", reflect.String},
		{"characteristics.WS.value", reflect.String},
		{"skillsLeft.tech-use.plus10", reflect.Bool},
		{"size", reflect.Int},
		{"talents.list.items.V1StGXR8_Z5jdHi6B-myT", reflect.Struct},
		{"talents.list.layouts.V1StGXR8_Z5jdHi6B-myT.colIndex", reflect.Int},
		// A pointer to a struct is walked through.
		{"psykana.tabs.items.t1.powers.items.p1.roll.effectivePR", reflect.Int},
		{"settings.psykana.sustained", reflect.Bool},
		{"gear.list.items.g1.entries.items.cond-Flak Vest-00-8c3a764840.apValue", reflect.String},
	}
	for _, tt := range good {
		got, err := CheckSheetPath(dots(tt.path))
		if err != nil {
			t.Errorf("%s: %v", tt.path, err)
			continue
		}
		if got.Kind() != tt.kind {
			t.Errorf("%s: %s, want %s", tt.path, got.Kind(), tt.kind)
		}
	}

	bad := []struct {
		path   []string
		reason string
	}{
		{nil, "empty path"},
		{dots("characterInfo.nickname"), "unknown field"},
		{dots("characterInfo.characterName.first"), "inside a string"},
		{dots("talents.list.items.t1.name_ru"), "unknown field"},
		{[]string{"talents", "list", "items", "", "name"}, "empty key"},
		{[]string{"talents", "list", "items", "a\nb", "name"}, "unprintable"},
		{[]string{"talents", "list", "items", strings.Repeat("x", 65), "name"}, "longer than 64"},
		{append(dots("talents.list.items"), strings.Split(strings.Repeat("a.", 14)+"a", ".")...), "deeper than 16"},
	}
	for _, tt := range bad {
		_, err := CheckSheetPath(tt.path)
		var shape *SheetShapeError
		if !errors.As(err, &shape) || !strings.Contains(err.Error(), tt.reason) {
			t.Errorf("%q: %v, want %q", tt.path, err, tt.reason)
		}
	}
}

func TestCheckSheetChange(t *testing.T) {
	good := []struct{ path, value string }{
		{"characterInfo.characterName", `"Kharn"`},
		// A text input keeps a Go number as a string; a number input sends
		// null while it is empty.
		{"armour.woundsCur", `12`},
		{"armour.woundsCur", `"12"`},
		{"armour.woundsCur", `null`},
		{"initiative.lastInitiative", `"0"`},
		{"skillsLeft.awareness.plus0", `true`},
		{"settings.meleeAttacks.stances", `false`},
	}
	for _, tt := range good {
		if err := CheckSheetChange(dots(tt.path), json.RawMessage(tt.value)); err != nil {
			t.Errorf("%s = %s: %v", tt.path, tt.value, err)
		}
	}

	bad := []struct{ path, value, reason string }{
		{"characterInfo.characterName", `12`, "string expected, got number"},
		{"characterInfo.characterName", `null`, "string expected, got null"},
		{"skillsLeft.awareness.plus0", `"true"`, "bool expected, got string"},
		{"armour.woundsCur", `{"x":1}`, "number expected, got object"},
		{"armour.woundsCur", `[1]`, "number expected, got array"},
		// An object is not written whole by a change.
		{"characterInfo", `{"characterName":"Kharn"}`, "a change of a struct"},
		{"characterInfo.nickname", `"Kharn"`, "unknown field"},
		{"armour.woundsCur", `{`, "not JSON"},
	}
	for _, tt := range bad {
		err := CheckSheetChange(dots(tt.path), json.RawMessage(tt.value))
		if err == nil || !strings.Contains(err.Error(), tt.reason) {
			t.Errorf("%s = %s: %v, want %q", tt.path, tt.value, err, tt.reason)
		}
	}
}

func TestCheckSheetBatch(t *testing.T) {
	good := []struct{ path, changes string }{
		{"skillsLeft.awareness", `{"plus0":true,"plus10":false}`},
		// cast.ts writes the cast whole.
		{"psykana.tabs.items.t1.powers.items.p1", `{"cast":{"pr":3,"kick":0,"safe":true,"phenomena":"","requestId":"r1"}}`},
		// A grid of mods copied whole; Go writes a nil map as null.
		{"rangedAttacks.list.items.r1", `{"damageMods":{"items":{"m1":{"expr":"1","enabled":true}},"layouts":null}}`},
		{"characteristics", `{"WS":{"value":"40"}}`},
	}
	for _, tt := range good {
		if err := CheckSheetBatch(dots(tt.path), json.RawMessage(tt.changes)); err != nil {
			t.Errorf("%s <- %s: %v", tt.path, tt.changes, err)
		}
	}

	bad := []struct{ path, changes, reason string }{
		{"skillsLeft.awareness.plus0", `{"x":true}`, "a batch into a bool"},
		{"skillsLeft.awareness", `{"plus0":"yes"}`, "skillsLeft.awareness.plus0: bool expected, got string"},
		{"skillsLeft.awareness", `{"plus40":true}`, "skillsLeft.awareness.plus40: unknown field"},
		{"skillsLeft.awareness", `[true]`, "object expected, got array"},
		{"psykana.tabs.items.t1.powers.items.p1", `{"cast":{"pr":{"x":1}}}`, "cast.pr: number expected, got object"},
		{"characteristics", `{"W.S":{"value":"40"}}`, "dot"},
	}
	for _, tt := range bad {
		err := CheckSheetBatch(dots(tt.path), json.RawMessage(tt.changes))
		if err == nil || !strings.Contains(err.Error(), tt.reason) {
			t.Errorf("%s <- %s: %v, want %q", tt.path, tt.changes, err, tt.reason)
		}
	}
}

func TestCheckSheetGridAndItem(t *testing.T) {
	item, err := CheckSheetGrid(dots("talents.list.items"))
	if err != nil || item != reflect.TypeFor[NamedDescription]() {
		t.Errorf("talents grid: %v, %v", item, err)
	}
	// The grid of a gear item's enchantments sits behind a pointer.
	if _, err := CheckSheetGrid(dots("gear.list.items.g1.enchantments.items")); err != nil {
		t.Errorf("enchantments grid: %v", err)
	}
	for _, p := range []string{"talents.list", "talents.list.layouts", "characteristics", "talents.list.items.t1"} {
		if _, err := CheckSheetGrid(dots(p)); err == nil || !strings.Contains(err.Error(), "not the items of a grid") {
			t.Errorf("%s: %v, want not a grid", p, err)
		}
	}

	if _, err := CheckSheetItem(dots("traits.list.items.t1")); err != nil {
		t.Errorf("traits item: %v", err)
	}
	for _, p := range []string{"traits.list.items", "traits", "characteristics.WS"} {
		if _, err := CheckSheetItem(dots(p)); err == nil {
			t.Errorf("%s: no error, want not an item", p)
		}
	}
}

func TestCheckSheetValue(t *testing.T) {
	init := `{"name":"Iron Will","description":""}`
	if err := CheckSheetValue(dots("talents.list.items.t1"), json.RawMessage(init)); err != nil {
		t.Errorf("new talent: %v", err)
	}
	// An optional roll may be missing (null) or an object, nothing else.
	power := `{"name":"Smite","roll":null}`
	if err := CheckSheetValue(dots("psykana.tabs.items.t1.powers.items.p1"), json.RawMessage(power)); err != nil {
		t.Errorf("power without a roll: %v", err)
	}
	for _, tt := range []struct{ value, reason string }{
		{`{"name":"Iron Will","name_ru":"Железная воля"}`, "talents.list.items.t1.name_ru: unknown field"},
		{`{"name":["Iron Will"]}`, "string expected, got array"},
		{`"Iron Will"`, "object expected, got string"},
		{`null`, "object expected, got null"},
	} {
		err := CheckSheetValue(dots("talents.list.items.t1"), json.RawMessage(tt.value))
		if err == nil || !strings.Contains(err.Error(), tt.reason) {
			t.Errorf("%s: %v, want %q", tt.value, err, tt.reason)
		}
	}
}

// Every field the client schemas know, of every sheet kind, is a path the
// check takes, to a scalar; every grid on the way is a grid. The file is
// written by `npm run gen:schema-paths` (scripts/schema-paths).
func TestCheckSheetPathTakesTheClientSchemas(t *testing.T) {
	b, err := os.ReadFile("testdata/schema_paths.json")
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	if err := json.Unmarshal(b, &paths); err != nil {
		t.Fatal(err)
	}
	if len(paths) < 100 {
		t.Fatalf("%d paths, want the whole schema", len(paths))
	}
	for _, p := range paths {
		segs := dots(strings.ReplaceAll(p, "*", "V1StGXR8_Z5jdHi6B-myT"))
		leaf, err := CheckSheetPath(segs)
		if err != nil {
			t.Errorf("%s: %v", p, err)
			continue
		}
		if !isScalar(leaf) {
			t.Errorf("%s: a %s, want a field", p, leaf.Kind())
		}
		for i, seg := range segs {
			if seg == "items" {
				if _, err := CheckSheetGrid(segs[:i+1]); err != nil {
					t.Errorf("%s: %v", p, err)
				}
			}
		}
	}
}
