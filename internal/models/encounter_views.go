package models

import (
	"encoding/json"
	"errors"
	"time"
	"unicode/utf8"
)

// The encounter as its clients see it: the gamemaster's (EncounterState, from
// GET /encounter/:id and the encounterState message) and the players'
// (InitiativeView). tygo writes their TS types into
// ui/static/js/room/encounter/types.gen.ts.

// EncounterState is an encounter with its groups and participants. The
// initiative of a participant is not here: it lives in the participant's sheet.
type EncounterState struct {
	ID     int    `json:"id"`
	RoomID int    `json:"roomId"`
	Name   string `json:"name"`
	// Description is the gamemaster's notes; the players never get them. They
	// go apart from the state, which every change of the encounter sends: in
	// GET /encounter/:id and in the encounterNotes message.
	Description string `json:"-"`
	Round       int    `json:"round"`
	// CurrentGroupID is the group whose turn it is; null before the first
	// "Next" and after a reset.
	CurrentGroupID *int `json:"currentGroupId" tstype:"number | null,required"`
	// Shown is whether the players see this encounter's InitiativeView.
	Shown bool `json:"shown"`
	// InitiativeView is what the gamemaster's client last published; null
	// before it has.
	InitiativeView *InitiativeView `json:"initiativeView" tstype:"InitiativeView | null,required"`
	Version        int             `json:"version"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	// Groups and Participants are those of the encounter and of the party of
	// its room. Groups are in turn order: by position, then by the order they
	// were added.
	Groups       []EncounterGroup       `json:"groups"`
	Participants []EncounterParticipant `json:"participants"`
	// Renamed is the NPC that copies of it made "Orc" into "Orc 1": its open
	// sheets hear of the new name apart from the state.
	Renamed *SheetName `json:"-"`
}

type EncounterGroup struct {
	ID int `json:"id"`
	// Position is the group's place in this encounter; null for a group of
	// the party not yet sorted here, which comes last.
	Position *int    `json:"position" tstype:"number | null,required"`
	Name     *string `json:"name" tstype:"string | null,required"`
	// Room is whether the group is of the party of the room rather than of
	// this encounter.
	Room bool `json:"room"`
}

type EncounterParticipant struct {
	ID      int `json:"id"`
	GroupID int `json:"groupId"`
	SheetID int `json:"sheetId"`
	// DisplayName is the name the players see instead of the sheet's.
	DisplayName *string `json:"displayName" tstype:"string | null,required"`
	// NPC is whether the sheet lives in this encounter; otherwise it is a
	// sheet of the room, a character.
	NPC bool `json:"npc"`
	// Side is the column the gamemaster put the participant in.
	Side string `json:"side" tstype:"'party' | 'enemies'"`
	// Name is the character name of the sheet.
	Name string `json:"name"`
	// SourceCreatureID is the creature of the NPC's owner the NPC was copied
	// from, next to which "Add variant to bestiary" puts its variant; null for
	// none.
	SourceCreatureID   *int    `json:"sourceCreatureId" tstype:"number | null,required"`
	SourceCreatureName *string `json:"sourceCreatureName" tstype:"string | null,required"`
	// SourceLabel is "collection · author" of the NPC copied from another
	// user's creature; null for a character.
	SourceLabel *string `json:"sourceLabel" tstype:"string | null,required"`
}

// EncounterVersion is an encounter a change reached, at its version after the
// change (the encountersChanged message).
type EncounterVersion struct {
	ID      int `json:"id"`
	Version int `json:"version"`
}

// EncounterSummary is an encounter in the gamemaster's picker.
type EncounterSummary struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// EncounterList is the encounters of a room, the last changed first.
type EncounterList struct {
	Encounters       []EncounterSummary `json:"encounters"`
	ShownEncounterID *int               `json:"shownEncounterId" tstype:"number | null,required"`
}

// EncounterLoadResult is how one file of "Load from files…" went.
type EncounterLoadResult struct {
	File string `json:"file"`
	// The encounter the file made, its name and how many NPCs it has; unset
	// when it made none.
	EncounterID int    `json:"encounterId,omitempty"`
	Name        string `json:"name,omitempty"`
	Npcs        int    `json:"npcs"`
	// Error is "invalid" or "quota"; empty when the file is in.
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// InitiativeView is the turn order the players see: no sheet ids and no
// wounds, and the names the gamemaster gave for the players.
type InitiativeView struct {
	Round int `json:"round"`
	// Current is the index of the row whose turn it is; null for none.
	Current *int            `json:"current" tstype:"number | null,required"`
	Rows    []InitiativeRow `json:"rows"`
}

type InitiativeRow struct {
	Name string `json:"name"`
	// Value is null for a group none of whom has rolled.
	Value *int `json:"value" tstype:"number | null,required"`
}

const (
	maxInitiativeRows    = 200
	maxInitiativeRowName = 200
)

var ErrInvalidInitiativeView = errors.New("models: invalid initiative view")

// ParseInitiativeView reads a view the gamemaster's client sent. What it
// keeps is only the fields above, so nothing else it may carry reaches the
// players.
func ParseInitiativeView(raw json.RawMessage) (*InitiativeView, error) {
	var v InitiativeView
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, ErrInvalidInitiativeView
	}
	if v.Round < 1 || len(v.Rows) > maxInitiativeRows {
		return nil, ErrInvalidInitiativeView
	}
	if v.Current != nil && (*v.Current < 0 || *v.Current >= len(v.Rows)) {
		return nil, ErrInvalidInitiativeView
	}
	for _, r := range v.Rows {
		if utf8.RuneCountInString(r.Name) > maxInitiativeRowName {
			return nil, ErrInvalidInitiativeView
		}
	}
	if v.Rows == nil {
		v.Rows = []InitiativeRow{}
	}
	return &v, nil
}
