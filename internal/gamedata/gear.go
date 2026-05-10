package gamedata

type Gear struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type GearIndex = Index[Gear, *Gear]
