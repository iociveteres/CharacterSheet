package models

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"unicode"
)

// The shape of the sheet content as CharacterSheetContent declares it, for
// checking where an edit writes and what (_prd/robustness/plan.md, 2б). Game
// sense is not checked: open lists and odd numbers are a normal sheet.

// maxSheetPathDepth bounds a path; the deepest field of the content is 9
// segments down (psykana.tabs.items.<id>.powers.items.<id>.roll.<field>).
const maxSheetPathDepth = 16

// maxSheetKeyLength bounds a map key: item ids are nanoids of 21 characters,
// the keys of characteristics and skills are constants of the client, and the
// ids of creatures imported from the book hold a gear name.
const maxSheetKeyLength = 64

// SheetShapeError is where an edit leaves the shape of the content. It names
// the path and the kind of the value, never the value.
type SheetShapeError struct {
	Path   string
	Reason string
}

func (e *SheetShapeError) Error() string {
	if e.Path == "" {
		return e.Reason
	}
	return e.Path + ": " + e.Reason
}

func shapeError(path []string, format string, args ...any) error {
	return &SheetShapeError{Path: strings.Join(path, "."), Reason: fmt.Sprintf(format, args...)}
}

// shapeNode is a type of the content with its pointers taken off.
type shapeNode struct {
	t      reflect.Type
	fields map[string]*shapeNode // a struct's, by JSON name
	elem   *shapeNode            // a map's or a slice's
	// grid marks the Items map of an ItemGrid: the maps edits create items in.
	grid bool
	// nullable is a pointer, a map or a slice: Go writes nil ones as null,
	// as sheets made by the server have grids with "items": null.
	nullable bool
}

// sheetShape is built once, at startup, from the Go struct: the struct is the
// source of truth, not a second list of paths.
var sheetShape = buildShape(reflect.TypeFor[CharacterSheetContent](), map[reflect.Type]*shapeNode{})

func buildShape(t reflect.Type, seen map[reflect.Type]*shapeNode) *shapeNode {
	if t.Kind() == reflect.Pointer {
		n := *buildShape(t.Elem(), seen)
		n.nullable = true
		return &n
	}
	if n, ok := seen[t]; ok {
		return n
	}
	n := &shapeNode{t: t}
	seen[t] = n
	switch t.Kind() {
	case reflect.Struct:
		n.fields = map[string]*shapeNode{}
		for i := range t.NumField() {
			f := t.Field(i)
			name, ok := jsonName(f)
			if !ok {
				continue
			}
			n.fields[name] = buildShape(f.Type, seen)
		}
		// The generic type's name is "ItemGrid[<element type>]".
		if strings.HasPrefix(t.Name(), "ItemGrid[") {
			items := *n.fields["items"]
			items.grid = true
			n.fields["items"] = &items
		}
	case reflect.Map, reflect.Slice:
		n.elem = buildShape(t.Elem(), seen)
		n.nullable = true
	case reflect.Array:
		n.elem = buildShape(t.Elem(), seen)
	}
	return n
}

// jsonName is the name encoding/json gives the field; false for one it skips.
func jsonName(f reflect.StructField) (string, bool) {
	if !f.IsExported() {
		return "", false
	}
	tag := f.Tag.Get("json")
	if tag == "-" {
		return "", false
	}
	if name, _, _ := strings.Cut(tag, ","); name != "" {
		return name, true
	}
	return f.Name, true
}

// CheckSheetKey checks a map key of the content: an item id or the key of a
// characteristic or a skill. Item ids are nanoids ([A-Za-z0-9_-]), but those
// of creatures imported from the book hold a gear name with spaces
// ("cond-Flak Vest-00-8c3a764840", ../BookParser/bestiary/build.py), so any
// printable character goes but the dot, which splits a path.
func CheckSheetKey(key string) error {
	if key == "" {
		return &SheetShapeError{Reason: "empty key"}
	}
	if len(key) > maxSheetKeyLength {
		return &SheetShapeError{Reason: fmt.Sprintf("key longer than %d", maxSheetKeyLength)}
	}
	for _, r := range key {
		if r == '.' || !unicode.IsPrint(r) {
			return &SheetShapeError{Reason: "key with a dot or an unprintable character"}
		}
	}
	return nil
}

func walkSheetPath(path []string) (*shapeNode, error) {
	if len(path) == 0 {
		return nil, shapeError(nil, "empty path")
	}
	if len(path) > maxSheetPathDepth {
		return nil, shapeError(path, "deeper than %d", maxSheetPathDepth)
	}
	n := sheetShape
	for i, seg := range path {
		switch n.t.Kind() {
		case reflect.Struct:
			next, ok := n.fields[seg]
			if !ok {
				return nil, shapeError(path[:i+1], "unknown field")
			}
			n = next
		case reflect.Map:
			if err := CheckSheetKey(seg); err != nil {
				return nil, shapeError(path[:i+1], "%s", err.(*SheetShapeError).Reason)
			}
			n = n.elem
		default:
			// The client writes no slice by index, and a scalar has nothing inside.
			return nil, shapeError(path[:i+1], "inside a %s", n.t.Kind())
		}
	}
	return n, nil
}

// CheckSheetPath returns the type the path leads to in CharacterSheetContent,
// pointers taken off, or where it leaves the content.
func CheckSheetPath(path []string) (reflect.Type, error) {
	n, err := walkSheetPath(path)
	if err != nil {
		return nil, err
	}
	return n.t, nil
}

// CheckSheetChange checks a change message: a scalar field and a value of
// its kind. An object or an array is never written whole by a change.
func CheckSheetChange(path []string, value json.RawMessage) error {
	n, err := walkSheetPath(path)
	if err != nil {
		return err
	}
	if !isScalar(n.t) {
		return shapeError(path, "a change of a %s", n.t.Kind())
	}
	return checkValue(n, path, value)
}

// CheckSheetBatch checks a batch message: path leads to an object, and each
// of the changes is a field of it with a value of its kind. A field that is
// an object takes an object whole, as cast.ts writes `cast`.
func CheckSheetBatch(path []string, changes json.RawMessage) error {
	n, err := walkSheetPath(path)
	if err != nil {
		return err
	}
	if k := n.t.Kind(); k != reflect.Struct && k != reflect.Map {
		return shapeError(path, "a batch into a %s", k)
	}
	return checkValue(n, path, changes)
}

// CheckSheetGrid checks the path of a grid's items, as createItem,
// positionsChanged and moveItemBetweenGrids name it, and returns the type of
// its items.
func CheckSheetGrid(path []string) (reflect.Type, error) {
	n, err := walkSheetPath(path)
	if err != nil {
		return nil, err
	}
	if !n.grid {
		return nil, shapeError(path, "not the items of a grid")
	}
	return n.elem.t, nil
}

// CheckSheetItem checks the path of an item of a grid, as deleteItem and
// autocompleteApply name it, and returns the type of the item.
func CheckSheetItem(path []string) (reflect.Type, error) {
	if len(path) < 2 {
		return nil, shapeError(path, "not an item of a grid")
	}
	t, err := CheckSheetGrid(path[:len(path)-1])
	if err != nil {
		return nil, err
	}
	if err := CheckSheetKey(path[len(path)-1]); err != nil {
		return nil, shapeError(path, "%s", err.(*SheetShapeError).Reason)
	}
	return t, nil
}

// CheckSheetValue checks that value fits what path leads to, whole: the
// init of a new item, the base of an autocompleted one.
func CheckSheetValue(path []string, value json.RawMessage) error {
	n, err := walkSheetPath(path)
	if err != nil {
		return err
	}
	return checkValue(n, path, value)
}

func isScalar(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Struct, reflect.Map, reflect.Slice, reflect.Array, reflect.Interface:
		return false
	}
	return true
}

// checkValue checks a JSON value against the type of node n at path. The
// rules follow what the client keeps (sheet/schema/spec.ts): a text input
// holds a string even where Go has a number, so a Go number takes a number or
// a string; a bool takes only a bool, a string only a string. Null goes only
// where Go keeps a nil, and for numbers. Unlike
// json.Unmarshal into the type, the same rules hold at every depth, and an
// unknown field of an object is reported, not dropped.
func checkValue(n *shapeNode, path []string, value json.RawMessage) error {
	var v any
	d := json.NewDecoder(bytes.NewReader(value))
	d.UseNumber()
	if err := d.Decode(&v); err != nil {
		return shapeError(path, "not JSON")
	}
	return checkDecoded(n, path, v)
}

func checkDecoded(n *shapeNode, path []string, v any) error {
	if v == nil && n.nullable {
		return nil
	}
	switch n.t.Kind() {
	case reflect.Interface:
		return nil
	case reflect.Bool:
		if _, ok := v.(bool); !ok {
			return shapeError(path, "bool expected, got %s", jsonKind(v))
		}
	case reflect.String:
		if _, ok := v.(string); !ok {
			return shapeError(path, "string expected, got %s", jsonKind(v))
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		switch v.(type) {
		// A number input sends null while it is empty or holds "-"
		// (NumberField in sheet/components/fields.tsx).
		case json.Number, string, nil:
		default:
			return shapeError(path, "number expected, got %s", jsonKind(v))
		}
	case reflect.Struct:
		obj, ok := v.(map[string]any)
		if !ok {
			return shapeError(path, "object expected, got %s", jsonKind(v))
		}
		for key, fv := range obj {
			field, ok := n.fields[key]
			at := append(path[:len(path):len(path)], key)
			if !ok {
				return shapeError(at, "unknown field")
			}
			if err := checkDecoded(field, at, fv); err != nil {
				return err
			}
		}
	case reflect.Map:
		obj, ok := v.(map[string]any)
		if !ok {
			return shapeError(path, "object expected, got %s", jsonKind(v))
		}
		for key, ev := range obj {
			at := append(path[:len(path):len(path)], key)
			if err := CheckSheetKey(key); err != nil {
				return shapeError(at, "%s", err.(*SheetShapeError).Reason)
			}
			if err := checkDecoded(n.elem, at, ev); err != nil {
				return err
			}
		}
	case reflect.Slice, reflect.Array:
		arr, ok := v.([]any)
		if !ok {
			return shapeError(path, "array expected, got %s", jsonKind(v))
		}
		for _, ev := range arr {
			if err := checkDecoded(n.elem, path, ev); err != nil {
				return err
			}
		}
	default:
		return shapeError(path, "a %s field", n.t.Kind())
	}
	return nil
}

// jsonKind names the kind of a decoded JSON value, for a log line that must
// not hold the value.
func jsonKind(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "bool"
	case json.Number:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	return fmt.Sprintf("%T", v)
}
