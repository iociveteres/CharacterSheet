package validator

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Validator struct {
	NonFieldErrors []string
	FieldErrors    map[string]string
}

var EmailRX = regexp.MustCompile("^[a-zA-Z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")

// Valid() returns true if the FieldErrors map doesn't contain any entries.
func (v *Validator) Valid() bool {
	return len(v.FieldErrors) == 0 && len(v.NonFieldErrors) == 0
}

// Create an AddNonFieldError() helper for adding error messages to the new
// NonFieldErrors slice.
func (v *Validator) AddNonFieldError(message string) {
	v.NonFieldErrors = append(v.NonFieldErrors, message)
}

// AddFieldError() adds an error message to the FieldErrors map (so long as no
// entry already exists for the given key).
func (v *Validator) AddFieldError(key, message string) {
	// Note: We need to initialize the map first, if it isn't already
	// initialized.
	if v.FieldErrors == nil {
		v.FieldErrors = make(map[string]string)
	}
	if _, exists := v.FieldErrors[key]; !exists {
		v.FieldErrors[key] = message
	}
}

// CheckField() adds an error message to the FieldErrors map only if a
// validation check is not 'ok'.
func (v *Validator) CheckField(ok bool, key, message string) {
	if !ok {
		v.AddFieldError(key, message)
	}
}

// NotBlank() returns true if a value is not an empty string.
func NotBlank(value string) bool {
	return strings.TrimSpace(value) != ""
}

// MaxChars() returns true if a value contains no more than n characters.
func MaxChars(value string, n int) bool {
	return utf8.RuneCountInString(value) <= n
}

// PermittedValue() returns true if the value of type T equals
// one of the variadic permittedValues parameters.
func PermittedValue[T comparable](value T, permittedValues ...T) bool {
	for i := range permittedValues {
		if value == permittedValues[i] {
			return true
		}
	}
	return false
}

// MinChars() returns true if a value contains at least n characters.
func MinChars(value string, n int) bool {
	return utf8.RuneCountInString(value) >= n
}

// Matches() returns true if a value matches a provided compiled regular
// expression pattern.
func Matches(value string, rx *regexp.Regexp) bool {
	return rx.MatchString(value)
}

var schemaHints = map[string]string{
	"experience.experience-total":     "number",
	"experience.experience-spent":     "number",
	"experience.experience-remaining": "number",
	"experience.*.experience-cost":    "number",
	"gear.*.weight":                   "number",
	"movement.move_half":              "number",
	"movement.move_full":              "number",
	"armour.wounds_max":               "number",
	"armour.wounds_cur":               "number",
	"initiative":                      "number",
	"size":                            "number",
	"*.*.difficulty":                  "number",
	"*.*.+0":                          "boolean",
	"*.*.+10":                         "boolean",
	"*.*.+20":                         "boolean",
	"*.*.+30":                         "boolean",
}

func ValidateField(dotPath string, value json.RawMessage) error {
	if dotPath == "" {
		return fmt.Errorf("empty path")
	}

	for pattern, kind := range schemaHints {
		if patternMatch(pattern, dotPath) {
			// hint exists -> validate type
			if err := validateJSONKind(kind, value); err != nil {
				return err
			}
			return nil
		}
	}

	// no hint -> everything is OK
	return nil
}

func ValidateBatch(basePath string, changes json.RawMessage) error {
	var changesMap map[string]json.RawMessage
	if err := json.Unmarshal(changes, &changesMap); err != nil {
		return fmt.Errorf("invalid changes object: %w", err)
	}

	errs := make(map[string]error, len(changesMap))

	for key, rawVal := range changesMap {
		fullPath := basePath + "." + key
		err := ValidateField(fullPath, rawVal)
		if err != nil {
			errs[fullPath] = err
		}
	}

	if len(errs) == 0 {
		return nil
	}

	err := consolidateValidationErrors(errs)
	return err
}

func consolidateValidationErrors(errs map[string]error) error {
	if len(errs) == 0 {
		return nil
	}

	var sb strings.Builder

	for path, err := range errs {
		if err != nil {
			sb.WriteString(fmt.Sprintf(" %s (%v);", path, err))
		}
	}

	return fmt.Errorf("%s", sb.String())
}

func patternMatch(pattern, path string) bool {
	if pattern == path {
		return true
	}
	pParts := strings.Split(pattern, ".")
	tParts := strings.Split(path, ".")
	if len(pParts) != len(tParts) {
		return false
	}
	for i := range pParts {
		if pParts[i] == "*" {
			continue
		}
		if pParts[i] != tParts[i] {
			return false
		}
	}
	return true
}

// validateJSONKind checks that raw JSON value conforms to expectedKind
func validateJSONKind(expectedKind string, raw json.RawMessage) error {
	// Accept null only if we want to; here null is considered invalid except for object/array where you might accept it.
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("%w: null for expected %s", ErrBadType, expectedKind)
	}

	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}

	switch expectedKind {
	case "number":
		switch v.(type) {
		case float64, json.Number:
			return nil
		default:
			return fmt.Errorf("%w: expected number, got %T", ErrBadType, v)
		}
	case "boolean":
		if _, ok := v.(bool); ok {
			return nil
		}
		return fmt.Errorf("%w: expected boolean, got %T", ErrBadType, v)
	default:
		// everything else is a string and will be fine
		return nil
	}
}
