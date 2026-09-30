package commands

import (
	"strings"
)

type CommandResult struct {
	Success bool
	Result  string
	// Versus is the outcome of a single roll against a target, for the sheet
	// that asked for it; the chat shows Result.
	Versus *VersusOutcome
}

// VersusOutcome is what a roll against a target came to. Degrees are the
// successes on a success and the fails on a failure.
type VersusOutcome struct {
	Roll    int  `json:"roll"`
	Target  int  `json:"target"`
	Success bool `json:"success"`
	Degrees int  `json:"degrees"`
	Crit    bool `json:"crit"`
	// Doubles is set for a plain d100 whose digits match: 11, 22 … 99, and
	// 100 as 00.
	Doubles bool `json:"doubles"`
}

type Command struct {
	Command             string
	Description         string
	DetailedDescription string
}

var commandsMap = map[string]Command{
	"/r": {
		Command:     "/r",
		Description: "roll a die",
		DetailedDescription: `d6 — roll 1d6
1d3 — roll 1d3
d100 + 32 — roll 1d100, add 32
2d100 — roll 2d100, sum results
4d6k3 — roll 4d6, keep the 3 highest, sum them
2d6-1+d10 — roll 2d6 and 1d10, subtract 1, sum all
3(d6+2) — roll 1d6, add 2, multiply total by 3
13x(2d10+25) — repeat 13 times: roll 2d10, add 25; print each result on a new line in ascending order

Versus rolls (roll vs difficulty):
d100 vs 70 — roll 1d100, compare to 70, count success/fail levels
2d50+3 vs 77 — roll 2d50+3, compare to 77
d100 vs 77 [+1] — roll d100, compare to 77, if succesfull add +1 extra success
5x(d100 vs 50) — repeat 5 times, aggregate success/fail levels

Success/fail levels: Every 10 points above/below target adds 1 level
Critical results: Values 1-5 are critical success, 96-100 are critical failure (scaled for other dice)`,
	},
}

// AvailableCommands returns a slice suitable for templating: {{range .AvailableCommands}}...
func AvailableCommands() []Command {
	out := make([]Command, 0, len(commandsMap))
	for _, c := range commandsMap {
		out = append(out, c)
	}
	return out
}

func ParseAndExecuteCommand(messageBody string) *CommandResult {
	if !strings.HasPrefix(messageBody, "/") {
		return nil // Not a command
	}

	parts := strings.Fields(messageBody)
	commandName := strings.TrimPrefix(parts[0], "/")
	args := strings.Join(parts[1:], " ")

	switch commandName {
	case "roll":
		r := executeRollCommand(args)
		return &r
	case "r":
		r := executeRollCommand(args)
		return &r
	default:
		return &CommandResult{
			Success: false,
			Result:  "Unknown command: /" + commandName,
		}
	}
}
