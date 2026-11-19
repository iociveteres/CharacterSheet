package commands

// ResultKindVersus is a roll against a target: "d100 vs 70", "5x(d100 vs 50)".
const ResultKindVersus = "versus"

// ResultKindInitiative is the initiative of NPCs rolled from an encounter
// (internal/roomws/encounter.go): it has Initiative and none of the fields of
// a versus roll.
const ResultKindInitiative = "initiative"

// ResultData is the result of a roll as data, stored with the message
// (room_messages.result_data): each viewer renders it in their own language
// (ui/static/js/room/commandResult.ts), and that rendering in English is the
// message's command_result (CommandResult.Result for a command). A plain roll
// has none: its result has no words.
type ResultData struct {
	Kind string `json:"kind" tstype:"\"versus\" | \"initiative\""`
	// Expression is the rolled expression without spaces, "d100" or "2d50+3".
	Expression string `json:"expression"`
	Target     int    `json:"target"`
	// Bonus is the extra successes of "[+N]", added on a success.
	Bonus int `json:"bonus,omitempty"`
	// Repeat is N of "Nx(...)"; 0 for a single roll.
	Repeat int          `json:"repeat,omitempty"`
	Rolls  []VersusRoll `json:"rolls"`
	// Total is the successes minus the fails of a repeated roll.
	Total *int `json:"total,omitempty"`
	// Initiative is the lines of a ResultKindInitiative.
	Initiative []InitiativeRoll `json:"initiative,omitempty"`
}

type InitiativeRoll struct {
	// Name is the NPC or the group as the players see it; empty for a group
	// the gamemaster did not name, which goes by Group.
	Name  string `json:"name"`
	Group int    `json:"group,omitempty"`
	// Expression is the rolled expression without spaces.
	Expression string `json:"expression"`
	Total      int    `json:"total"`
}

type VersusRoll struct {
	// Output is the breakdown of the roll; empty when it has no operators and
	// so is the bare number.
	Output string `json:"output,omitempty"`
	Roll   int    `json:"roll"`
	// Success: Degrees are the successes, else the fails.
	Success bool `json:"success"`
	Degrees int  `json:"degrees"`
	Crit    bool `json:"crit,omitempty"`
	// Doubles is set for a plain d100 whose digits match: 11, 22 … 99, and
	// 100 as 00.
	Doubles bool `json:"doubles,omitempty"`
}
