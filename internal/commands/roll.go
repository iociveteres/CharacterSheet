package commands

import (
	"maps"
	"fmt"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"
)

func executeRollCommand(args string) CommandResult {
	return executeRollCommandWithRand(args, rand.New(rand.NewSource(time.Now().UnixNano())))
}

func executeRollCommandWithRand(args string, rng *rand.Rand) CommandResult {
	args = strings.TrimSpace(args)
	if args == "" {
		return CommandResult{
			Success: false,
			Result:  "Usage: /roll <dice expression>",
		}
	}

	// Remove all spaces for easier parsing
	args = strings.ReplaceAll(args, " ", "")

	// Check if it's a multiple roll (Nx(...))
	if idx := strings.Index(args, "x("); idx > 0 {
		// Extract N
		nStr := args[:idx]
		n, err := strconv.Atoi(nStr)
		if err != nil || n < 1 || n > 100 {
			return CommandResult{
				Success: false,
				Result:  "Repetition count must be between 1 and 100",
			}
		}

		// Extract expression inside parentheses
		if !strings.HasSuffix(args, ")") {
			return CommandResult{
				Success: false,
				Result:  "Missing closing parenthesis",
			}
		}
		expr := args[idx+2 : len(args)-1]

		// Execute N times
		results := make([]int, n)
		outputs := make([]string, n)

		for i := 0; i < n; i++ {
			output, result, err := evaluate(expr, rng)
			if err != nil {
				return CommandResult{
					Success: false,
					Result:  err.Error(),
				}
			}
			results[i] = result
			// Add result to each output line
			outputs[i] = fmt.Sprintf("%s = %d", output, result)
		}

		// Sort results
		sortedResults := make([]int, n)
		copy(sortedResults, results)
		sort.Slice(sortedResults, func(i, j int) bool {
			return sortedResults[i] > sortedResults[j]
		})

		// Format output
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("%dx(%s):\n", n, expr))
		for _, output := range outputs {
			sb.WriteString(output)
			sb.WriteString("\n")
		}
		for i, r := range sortedResults {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(strconv.Itoa(r))
		}

		return CommandResult{
			Success: true,
			Result:  sb.String(),
		}
	}

	// Single evaluation
	output, result, err := evaluate(args, rng)
	if err != nil {
		return CommandResult{
			Success: false,
			Result:  err.Error(),
		}
	}

	// For simple single-value results (no operators in output),
	// just show the value without redundant "= result"
	// Check for any of: +, -, *, /, or parentheses
	hasOperators := strings.ContainsAny(output, "+-*/()")
	if !hasOperators {
		return CommandResult{
			Success: true,
			Result:  fmt.Sprintf("%s:\n%s", args, output),
		}
	}

	return CommandResult{
		Success: true,
		Result:  fmt.Sprintf("%s:\n%s = %d", args, output, result),
	}
}

func evaluate(expr string, rng *rand.Rand) (string, int, error) {
	var terms []struct {
		positive bool
		term     string
	}

	current := ""
	positive := true

	for i := 0; i < len(expr); i++ {
		ch := expr[i]
		if ch == '+' || (ch == '-' && i > 0 && expr[i-1] != 'd' && expr[i-1] != 'k' && expr[i-1] != 'l') {
			if current != "" {
				terms = append(terms, struct {
					positive bool
					term     string
				}{positive, current})
				current = ""
			}
			positive = (ch == '+')
		} else {
			current += string(ch)
		}
	}
	if current != "" {
		terms = append(terms, struct {
			positive bool
			term     string
		}{positive, current})
	}

	if len(terms) == 0 {
		return "", 0, fmt.Errorf("empty expression")
	}

	var outputs []string
	total := 0

	for _, t := range terms {
		output, value, err := evaluateTerm(t.term, rng)
		if err != nil {
			return "", 0, err
		}

		if !t.positive {
			value = -value
			output = "-" + output
		}

		if output != "" {
			outputs = append(outputs, output)
		}
		total += value
	}

	return strings.Join(outputs, " + "), total, nil
}

func evaluateTerm(term string, rng *rand.Rand) (string, int, error) {
	// Check for multiplier at the beginning (e.g., "3(...)")
	if idx := strings.Index(term, "("); idx > 0 {
		multStr := term[:idx]
		mult, err := strconv.Atoi(multStr)
		if err == nil && strings.HasSuffix(term, ")") {
			// It's a multiplier
			inner := term[idx+1 : len(term)-1]
			output, value, err := evaluate(inner, rng)
			if err != nil {
				return "", 0, err
			}
			return fmt.Sprintf("%d(%s)", mult, output), mult * value, nil
		}
	}

	// Check for parentheses
	if strings.HasPrefix(term, "(") && strings.HasSuffix(term, ")") {
		inner := term[1 : len(term)-1]
		output, value, err := evaluate(inner, rng)
		if err != nil {
			return "", 0, err
		}
		return "(" + output + ")", value, nil
	}

	// Check if it's a dice roll
	if strings.Contains(term, "d") {
		return evaluateDiceRoll(term, rng)
	}

	// It's a constant
	value, err := strconv.Atoi(term)
	if err != nil {
		return "", 0, fmt.Errorf("invalid term: %s", term)
	}
	return strconv.Itoa(value), value, nil
}

func evaluateDiceRoll(term string, rng *rand.Rand) (string, int, error) {
	// Parse formats: d6, 2d10, 4d6k3, 4d6l3
	parts := strings.Split(term, "d")
	if len(parts) != 2 {
		return "", 0, fmt.Errorf("invalid dice format: %s", term)
	}

	numDice := 1
	if parts[0] != "" {
		var err error
		numDice, err = strconv.Atoi(parts[0])
		if err != nil {
			return "", 0, fmt.Errorf("invalid number of dice: %s", parts[0])
		}
	}

	// Validate dice count
	if numDice < 1 || numDice > 1000 {
		return "", 0, fmt.Errorf("dice count must be between 1 and 1000")
	}

	// Check for keep highest (k) or keep lowest (l)
	diceSides := 0
	keepCount := numDice
	keepHighest := true

	remaining := parts[1]
	if idx := strings.Index(remaining, "k"); idx > 0 {
		var err error
		diceSides, err = strconv.Atoi(remaining[:idx])
		if err != nil {
			return "", 0, fmt.Errorf("invalid dice sides: %s", remaining[:idx])
		}
		keepCount, err = strconv.Atoi(remaining[idx+1:])
		if err != nil {
			return "", 0, fmt.Errorf("invalid keep count: %s", remaining[idx+1:])
		}
		keepHighest = true
	} else if idx := strings.Index(remaining, "l"); idx > 0 {
		var err error
		diceSides, err = strconv.Atoi(remaining[:idx])
		if err != nil {
			return "", 0, fmt.Errorf("invalid dice sides: %s", remaining[:idx])
		}
		keepCount, err = strconv.Atoi(remaining[idx+1:])
		if err != nil {
			return "", 0, fmt.Errorf("invalid keep count: %s", remaining[idx+1:])
		}
		keepHighest = false
	} else {
		var err error
		diceSides, err = strconv.Atoi(remaining)
		if err != nil {
			return "", 0, fmt.Errorf("invalid dice sides: %s", remaining)
		}
	}

	// Validate dice sides
	if diceSides < 1 || diceSides > 100000 {
		return "", 0, fmt.Errorf("dice sides must be between 1 and 100000")
	}

	// Roll the dice
	rolls := make([]int, numDice)
	for i := 0; i < numDice; i++ {
		rolls[i] = rng.Intn(diceSides) + 1
	}

	// Calculate sum and format output
	if keepCount < numDice {
		// Sort to keep highest or lowest
		sorted := make([]int, numDice)
		copy(sorted, rolls)
		sort.Ints(sorted)

		kept := make(map[int]int) // value -> count of how many to keep
		if keepHighest {
			for i := numDice - keepCount; i < numDice; i++ {
				kept[sorted[i]]++
			}
		} else {
			for i := 0; i < keepCount; i++ {
				kept[sorted[i]]++
			}
		}

		// Format output
		var parts []string
		sum := 0
		keptCopy := make(map[int]int)
		maps.Copy(keptCopy, kept)

		for _, roll := range rolls {
			if keptCopy[roll] > 0 {
				parts = append(parts, strconv.Itoa(roll))
				sum += roll
				keptCopy[roll]--
			} else {
				parts = append(parts, "("+strconv.Itoa(roll)+")")
			}
		}

		return strings.Join(parts, " + "), sum, nil
	} else {
		// Simple roll (keepCount >= numDice, so keep all)
		sum := 0
		var parts []string
		for _, roll := range rolls {
			parts = append(parts, strconv.Itoa(roll))
			sum += roll
		}
		return strings.Join(parts, " + "), sum, nil
	}
}
