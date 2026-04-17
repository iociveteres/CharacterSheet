package gamedata

import (
	"encoding/json"
	"fmt"
	"os"
)

// Catalog holds all loaded game data collections.
type Catalog struct {
	Advancements *AdvancementIndex
}

func Load() (*Catalog, error) {
	c := &Catalog{}

	raws, err := loadJSONRaw(advancementsPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("advancements: %w", err)
	}
	if raws != nil {
		idx, err := newAdvancementIndex(raws)
		if err != nil {
			return nil, fmt.Errorf("advancements: build index: %w", err)
		}
		c.Advancements = idx
	}

	return c, nil
}

// loadJSONRaw reads a JSON array from path as raw messages.
// Returns (nil, nil) when the file does not exist.
func loadJSONRaw(path string) ([]json.RawMessage, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var data []json.RawMessage
	if err := json.NewDecoder(f).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}
