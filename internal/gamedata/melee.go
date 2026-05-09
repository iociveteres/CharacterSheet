package gamedata

type Melee struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type MeleeIndex = Index[Melee, *Melee]
