package roomws

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/models"
)

// The label of a roll from a sheet as data: the client words its codes in
// each reader's language (ui/static/js/sheet/rollLabel.ts). The server knows
// no codes, only the shape and the limits, the same as parseLabel of
// ui/static/js/sheet/rollLabelText.ts; both are tested on
// testdata/roll_labels.json.
const (
	labelMaxParts = 64
	labelMaxDepth = 3
	labelMaxText  = 200
	labelMaxBytes = 2048
)

var (
	labelCode = regexp.MustCompile(`^[A-Za-z]+(:[A-Za-z0-9_+\-]+)?$`)
	labelName = regexp.MustCompile(`^[A-Za-z]+$`)
)

// storedLabel is raw without whitespace when it is a label (validLabel), nil otherwise.
func storedLabel(raw json.RawMessage) json.RawMessage {
	var buf bytes.Buffer
	if len(raw) == 0 || !validLabel(raw) || json.Compact(&buf, raw) != nil {
		return nil
	}
	return buf.Bytes()
}

// validLabel reports whether raw is a label of the right shape within the limits:
// {"n": part, "t"?: [part], "m"?: [part], "w"?: name, "k"?: sheet kind}.
func validLabel(raw json.RawMessage) bool {
	var buf bytes.Buffer
	if json.Compact(&buf, raw) != nil || buf.Len() > labelMaxBytes {
		return false
	}
	var label map[string]any
	if json.Unmarshal(raw, &label) != nil || label == nil {
		return false
	}
	n, ok := label["n"]
	if !ok {
		return false
	}
	parts := 0
	if !validLabelPart(n, 0, &parts) {
		return false
	}
	for key, value := range label {
		switch key {
		case "n":
		case "t", "m":
			list, ok := value.([]any)
			if !ok {
				return false
			}
			for _, part := range list {
				if !validLabelPart(part, 0, &parts) {
					return false
				}
			}
		case "w":
			if w, ok := value.(string); !ok || !labelName.MatchString(w) {
				return false
			}
		case "k":
			if k, ok := value.(string); !ok || !models.SheetKind(k).IsValid() {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// validLabelPart reports whether part is text or a code with its parameters,
// counting it and the parts among its parameters into parts.
func validLabelPart(part any, depth int, parts *int) bool {
	*parts++
	if *parts > labelMaxParts {
		return false
	}
	switch p := part.(type) {
	case string:
		return utf8.RuneCountInString(p) <= labelMaxText
	case []any:
		if len(p) < 1 || len(p) > 2 {
			return false
		}
		code, ok := p[0].(string)
		if !ok || !labelCode.MatchString(code) {
			return false
		}
		if len(p) == 1 {
			return true
		}
		params, ok := p[1].(map[string]any)
		if !ok || depth >= labelMaxDepth {
			return false
		}
		for name, value := range params {
			if !labelName.MatchString(name) {
				return false
			}
			if number, ok := value.(float64); ok {
				if math.IsInf(number, 0) || math.IsNaN(number) {
					return false
				}
				continue
			}
			if !validLabelPart(value, depth+1, parts) {
				return false
			}
		}
		return true
	}
	return false
}

// bodyWithoutLabel is a roll command with its ">>" label lines cut off, and
// whether it had any.
func bodyWithoutLabel(body string) (string, bool) {
	if !strings.HasPrefix(body, "/r ") && !strings.HasPrefix(body, "/roll ") {
		return body, false
	}
	idx := strings.Index(body, "\n>>")
	if idx < 0 {
		return body, false
	}
	return strings.TrimSpace(body[:idx]), true
}
