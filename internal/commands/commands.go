package commands

import (
	"strings"
)

type CommandResult struct {
	Success bool
	Result  string
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
13x(2d10+25) — repeat 13 times: roll 2d10, add 25; print each result on a new line in ascending order`,
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
