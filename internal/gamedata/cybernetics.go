package gamedata

type Cybernetics struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type CyberneticsIndex = Index[Cybernetics, *Cybernetics]
