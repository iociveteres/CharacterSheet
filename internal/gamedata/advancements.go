package gamedata

import (
	"encoding/json"
	"strings"
)

// Advancement embeds CollectionEntry for name search and pass-through apply,
// and adds extra fields for rich frontend dropdown rendering.
type Advancement struct {
	CollectionEntry
	Type           string          `json:"type"`
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`
}

// AdvancementIndex holds advancements and exposes prefix search.
type AdvancementIndex struct {
	data []Advancement
}

func newAdvancementIndex(raws []json.RawMessage) (*AdvancementIndex, error) {
	data := make([]Advancement, 0, len(raws))
	for _, raw := range raws {
		var a Advancement
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, err
		}
		a.raw = raw
		a.nameLower = strings.ToLower(a.Name)
		a.nameRuLower = strings.ToLower(a.NameRu)
		data = append(data, a)
	}
	return &AdvancementIndex{data: data}, nil
}

// GetByName returns the first advancement whose Name matches exactly
// (case-insensitive). Returns nil when not found.
func (idx *AdvancementIndex) GetByName(name string) *Advancement {
	n := strings.ToLower(strings.TrimSpace(name))
	for i := range idx.data {
		if strings.ToLower(idx.data[i].Name) == n {
			return &idx.data[i]
		}
	}
	return nil
}

// Search returns up to limit advancements whose name or name_ru contains query
// (case-insensitive). Prefix matches are returned before substring matches.
func (idx *AdvancementIndex) Search(query string, limit int) []Advancement {
	if limit <= 0 {
		limit = 10
	}
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil
	}

	var prefix, substr []Advancement
	for _, a := range idx.data {
		isPrefix := strings.HasPrefix(a.nameLower, q) || strings.HasPrefix(a.nameRuLower, q)
		isSub := !isPrefix && (strings.Contains(a.nameLower, q) || strings.Contains(a.nameRuLower, q))

		if isPrefix {
			prefix = append(prefix, a)
		} else if isSub {
			substr = append(substr, a)
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
