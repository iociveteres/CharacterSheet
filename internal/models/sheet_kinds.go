package models

import (
	"database/sql/driver"
	"fmt"
)

// SheetKind is a character sheet variant. Sheets of the same kind share the
// same layout, which the client renders (ui/static/js/sheet/kinds).
//
// Adding a kind means touching every place below:
//   - sheetKinds in this file
//   - the sheet_kind enum in the database (ALTER TYPE sheet_kind ADD VALUE),
//     a kind missing there fails on insert
//   - ui/static/js/sheet/kinds/kinds.gen.ts, regenerated with
//     `npm run gen:types`; CI fails when it is out of date
//   - a layout in ui/static/js/sheet/kinds/<kind>.tsx and its entry in LAYOUTS
//     (kinds/index.ts); tsc fails for a generated kind without one
type SheetKind string

const (
	KindBlackCrusade      SheetKind = "black_crusade"
	KindPathfinderCrusade SheetKind = "pathfinder_crusade"
)

// DefaultSheetKind is used for sheets created before kinds existed and for
// imported files without an explicit kind.
const DefaultSheetKind = KindBlackCrusade

type SheetKindInfo struct {
	Kind  SheetKind
	Label string
}

var sheetKinds = []SheetKindInfo{
	{Kind: KindBlackCrusade, Label: "Black Crusade"},
	{Kind: KindPathfinderCrusade, Label: "Pathfinder Crusade"},
}

// SheetKinds returns all known kinds in UI order.
func SheetKinds() []SheetKindInfo {
	return sheetKinds
}

func (k SheetKind) IsValid() bool {
	for _, info := range sheetKinds {
		if info.Kind == k {
			return true
		}
	}
	return false
}

func (k SheetKind) Label() string {
	for _, info := range sheetKinds {
		if info.Kind == k {
			return info.Label
		}
	}
	return string(k)
}

// ParseSheetKind converts a client-provided value into a SheetKind. An empty
// value means the default kind, anything unknown is an error.
func ParseSheetKind(s string) (SheetKind, error) {
	if s == "" {
		return DefaultSheetKind, nil
	}

	k := SheetKind(s)
	if !k.IsValid() {
		return "", fmt.Errorf("invalid SheetKind value: %q", s)
	}
	return k, nil
}

func (k *SheetKind) Scan(src any) error {
	var s string

	switch x := src.(type) {
	case string:
		s = x
	case []byte:
		s = string(x)
	default:
		return fmt.Errorf("cannot scan %T into SheetKind", src)
	}

	val := SheetKind(s)
	if !val.IsValid() {
		return fmt.Errorf("invalid SheetKind value: %q", s)
	}

	*k = val
	return nil
}

func (k SheetKind) Value() (driver.Value, error) {
	if !k.IsValid() {
		return nil, fmt.Errorf("invalid SheetKind value: %q", k)
	}
	return string(k), nil
}
