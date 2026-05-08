package gamedata

import (
	"encoding/json"
	"strings"
)

// CollectionEntry is a single item in a generic searchable collection.
// Raw holds the original JSON and is excluded from serialization —
// it is used only for pass-through in autocompleteApply.
type CollectionEntry struct {
	Name   string `json:"name"`
	NameRu string `json:"name_ru,omitempty"`
	raw    json.RawMessage
}

// ClientJSON returns the raw source JSON, ready to use as ApplyBatch changes.
func (e *CollectionEntry) ClientJSON() json.RawMessage { return e.raw }

// CollectionIndex holds a generic name-searchable collection.
type CollectionIndex struct {
	data []CollectionEntry
}

func newCollectionIndex(raws []json.RawMessage) (*CollectionIndex, error) {
	data := make([]CollectionEntry, 0, len(raws))
	for _, raw := range raws {
		var e CollectionEntry
		if err := json.Unmarshal(raw, &e); err != nil {
			return nil, err
		}
		e.raw = raw
		data = append(data, e)
	}
	return &CollectionIndex{data: data}, nil
}

// GetByName returns the entry whose Name matches exactly (case-insensitive),
// or nil when not found.
func (idx *CollectionIndex) GetByName(name string) *CollectionEntry {
	n := strings.ToLower(strings.TrimSpace(name))
	for i := range idx.data {
		if strings.ToLower(idx.data[i].Name) == n {
			return &idx.data[i]
		}
	}
	return nil
}

// Search returns up to limit entries whose name or name_ru contains query
// (case-insensitive). Prefix matches are returned before substring matches.
func (idx *CollectionIndex) Search(query string, limit int) []CollectionEntry {
	if limit <= 0 {
		limit = 10
	}
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil
	}

	var prefix, substr []CollectionEntry
	for _, e := range idx.data {
		name := strings.ToLower(e.Name)
		nameRu := strings.ToLower(e.NameRu)
		isPrefix := strings.HasPrefix(name, q) || strings.HasPrefix(nameRu, q)
		isSub := !isPrefix && (strings.Contains(name, q) || strings.Contains(nameRu, q))
		if isPrefix {
			prefix = append(prefix, e)
		} else if isSub {
			substr = append(substr, e)
		}
		if len(prefix)+len(substr) >= limit*2 {
			break
		}
	}

	combined := append(prefix, substr...)
	if len(combined) > limit {
		combined = combined[:limit]
	}
	return combined
}
