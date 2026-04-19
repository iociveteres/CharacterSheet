package gamedata

import (
	"encoding/json"
	"strings"
)

const advancementsPath = "internal/gamedata/assets/advancements.json"

// advTypeMap converts source type strings → ExperienceItem enum values.
// Only multi-word types need remapping; single-word ones are identity.
var advTypeMap = map[string]string{
	"characteristic":  "characteristic",
	"skill":           "skill",
	"talent":          "talent",
	"elite archetype": "eliteArchetype",
	"psychic power":   "psychicPower",
	"tech power":      "techPower",
}

// Advancement holds only what the backend needs for search/filtering.
// Everything else lives in clientJSON and is passed through as-is.
type Advancement struct {
	Name           string          `json:"name"`
	NameRu         string          `json:"name_ru,omitempty"`
	Type           string          `json:"type"` // raw source type, used for search filtering
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`

	// Pre-computed at load time: the full entry JSON with `type` remapped to
	// the ExperienceItem enum value. Sent verbatim as ApplyBatch changes.
	clientJSON json.RawMessage
}

// ClientJSON returns the pre-computed, client-ready JSON for this advancement.
func (a *Advancement) ClientJSON() json.RawMessage { return a.clientJSON }

// buildClientJSON remaps the `type` field and returns the entry ready to use
// as ApplyBatch changes. All other fields are passed through unchanged.
func buildClientJSON(raw json.RawMessage) (json.RawMessage, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if t, ok := m["type"].(string); ok {
		if mapped, exists := advTypeMap[t]; exists {
			m["type"] = mapped
		}
	}
	return json.Marshal(m)
}

// AdvancementIndex holds advancements and exposes prefix search.
type AdvancementIndex struct {
	data []Advancement
}

// newAdvancementIndex builds the index from raw JSON entries, computing
// clientJSON for each entry at load time.
func newAdvancementIndex(raws []json.RawMessage) (*AdvancementIndex, error) {
	data := make([]Advancement, 0, len(raws))
	for _, raw := range raws {
		var a Advancement
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, err
		}
		b, err := buildClientJSON(raw)
		if err != nil {
			return nil, err
		}
		a.clientJSON = b
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
// (case-insensitive). When itemType is non-empty, only that type is returned.
// Prefix matches are returned before substring matches.
func (idx *AdvancementIndex) Search(query, itemType string, limit int) []Advancement {
	if limit <= 0 {
		limit = 10
	}
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil
	}

	var prefix, substr []Advancement
	for _, a := range idx.data {
		if itemType != "" && a.Type != itemType {
			continue
		}
		name := strings.ToLower(a.Name)
		nameRu := strings.ToLower(a.NameRu)
		isPrefix := strings.HasPrefix(name, q) || strings.HasPrefix(nameRu, q)
		isSub := !isPrefix && (strings.Contains(name, q) || strings.Contains(nameRu, q))
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
