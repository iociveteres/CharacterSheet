package gamedata

type Ranged struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type RangedIndex = Index[Ranged, *Ranged]
