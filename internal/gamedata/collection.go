package gamedata

import (
	"encoding/json"
	"strings"
)

// indexable is the constraint for Index type parameters.
// CollectionEntry satisfies it; types embedding CollectionEntry inherit satisfaction.
type indexable interface {
	initRaw(json.RawMessage)
	ClientJSON() json.RawMessage
	getLowerNames() (string, string)
}

// CollectionEntry is the base entry type for simple name-searchable collections.
// Used directly as Index[CollectionEntry, *CollectionEntry] when no extra
// display fields are needed.
type CollectionEntry struct {
	Name   string `json:"name"`
	NameRu string `json:"name_ru,omitempty"`

	raw         json.RawMessage
	nameLower   string
	nameRuLower string
}

func (e *CollectionEntry) initRaw(raw json.RawMessage) {
	e.raw = raw
	e.nameLower = strings.ToLower(e.Name)
	e.nameRuLower = strings.ToLower(e.NameRu)
}

func (e *CollectionEntry) ClientJSON() json.RawMessage     { return e.raw }
func (e *CollectionEntry) getLowerNames() (string, string) { return e.nameLower, e.nameRuLower }

// Index is a generic name-searchable collection.
// T is the entry value type (CollectionEntry or a struct embedding it).
// PT is the pointer type (*T) satisfying indexable — the standard Go generics
// pattern for methods on pointer receivers.
//
// Simple collections:    Index[CollectionEntry, *CollectionEntry]
// Rich collections:      Index[Advancement, *Advancement]
type Index[T any, PT interface {
	*T
	indexable
}] struct {
	data []T
}

// NewIndex builds an index from raw JSON entries.
func NewIndex[T any, PT interface {
	*T
	indexable
}](raws []json.RawMessage) (*Index[T, PT], error) {
	data := make([]T, 0, len(raws))
	for _, raw := range raws {
		var zero T
		pt := PT(&zero)
		if err := json.Unmarshal(raw, pt); err != nil {
			return nil, err
		}
		pt.initRaw(raw)
		data = append(data, zero)
	}
	return &Index[T, PT]{data: data}, nil
}

// GetByName returns the first entry whose Name matches exactly (case-insensitive).
func (idx *Index[T, PT]) GetByName(name string) *T {
	n := strings.ToLower(strings.TrimSpace(name))
	for i := range idx.data {
		nl, _ := PT(&idx.data[i]).getLowerNames()
		if nl == n {
			return &idx.data[i]
		}
	}
	return nil
}

// Search returns up to limit entries whose name or name_ru contains query
// (case-insensitive). Prefix matches are returned before substring matches.
func (idx *Index[T, PT]) Search(query string, limit int) []T {
	if limit <= 0 {
		limit = 10
	}
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil
	}

	var prefix, substr []T
	for i := range idx.data {
		nl, nrlu := PT(&idx.data[i]).getLowerNames()
		isPrefix := strings.HasPrefix(nl, q) || strings.HasPrefix(nrlu, q)
		isSub := !isPrefix && (strings.Contains(nl, q) || strings.Contains(nrlu, q))
		if isPrefix {
			prefix = append(prefix, idx.data[i])
		} else if isSub {
			substr = append(substr, idx.data[i])
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

// Type aliases for cleaner usage at call sites.
type CollectionIndex = Index[CollectionEntry, *CollectionEntry]
