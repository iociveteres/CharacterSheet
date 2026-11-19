package commands

import (
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
)

type CommandResult struct {
	Success bool
	// Result is the result in English: the chat shows it when Data is nil
	// and for the messages stored before result_data.
	Result string
	Data   *ResultData
}

type Command struct {
	Command             string
	Description         string
	DetailedDescription string
}

// AvailableCommands lists the chat commands with their help in language lang.
func AvailableCommands(lang string) []Command {
	return []Command{{
		Command:             "/r",
		Description:         i18n.T(lang, "room.commands.r.description"),
		DetailedDescription: i18n.T(lang, "room.commands.r.detailedDescription"),
	}}
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
