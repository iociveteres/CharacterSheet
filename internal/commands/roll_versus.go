package commands

import (
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
)

// isVersusRoll checks if the expression contains a "vs" comparison
func isVersusRoll(expr string) bool {
	return strings.Contains(expr, "vs")
}

// parseVersusRoll splits expression into roll part and target difficulty
func parseVersusRoll(expr string) (rollExpr string, target int, bonusSuccesses int, err error) {
	// Groups: 1 rollExpr, 2 target, 3 bonus (optional)
	versusRegex := regexp.MustCompile(`^(.+?)\s*vs\s*(\d+)(?:\s*\[\+(\d+)\])?$`)

	matches := versusRegex.FindStringSubmatch(expr)
	if matches == nil {
		return "", 0, 0, fmt.Errorf("invalid vs format")
	}

	rollExpr = strings.TrimSpace(matches[1])

	target, err = strconv.Atoi(matches[2])
	if err != nil {
		return "", 0, 0, fmt.Errorf("invalid target value: %s", matches[2])
	}

	if matches[3] != "" {
		bonusSuccesses, err = strconv.Atoi(matches[3])
		if err != nil {
			return "", 0, 0, fmt.Errorf("invalid bonus successes: %s", matches[3])
		}
	}

	return rollExpr, target, bonusSuccesses, nil
}

// calculateSuccessLevel determines success/fail levels and if it's a critical
func calculateSuccessLevel(rollResult, target, maxValue, bonusSuccesses int) (level int, isCrit bool, isSuccess bool) {
	// Check for critical results (for d100: 1-5 and 96-100)
	// For other dice, scale proportionally
	critLowThreshold := max(1, maxValue/20) // 5% low
	critHighThreshold := maxValue - critLowThreshold + 1

	isCrit = (rollResult <= critLowThreshold) || (rollResult >= critHighThreshold)

	// Calculate success/failure levels based on distance from target
	if rollResult <= target {
		// Success: count how many complete tens below target
		diff := target - rollResult
		level = 1 + (diff / 10)
		// Add bonus successes only on success
		level += bonusSuccesses
		return level, isCrit, true
	} else {
		// Failure: count how many complete tens above target
		// DO NOT add bonus successes to failures
		diff := rollResult - target
		level = 1 + (diff / 10)
		return level, isCrit, false
	}
}

// executeVersusRollCommand handles versus roll logic
func executeVersusRollCommand(args string, rng *rand.Rand) CommandResult {
	args = strings.ReplaceAll(args, " ", "")

	// Check if it's a multiple roll (Nx(...))
	if idx := strings.Index(args, "x("); idx > 0 {
		return executeMultipleVersusRoll(args, rng)
	}

	// Single versus roll
	return executeSingleVersusRoll(args, rng)
}

// executeSingleVersusRoll handles a single roll vs difficulty
func executeSingleVersusRoll(args string, rng *rand.Rand) CommandResult {
	rollExpr, target, bonusSuccesses, err := parseVersusRoll(args)
	if err != nil {
		return CommandResult{
			Success: false,
			Result:  err.Error(),
		}
	}

	// Execute the roll
	output, result, err := evaluate(rollExpr, rng)
	if err != nil {
		return CommandResult{
			Success: false,
			Result:  err.Error(),
		}
	}

	// Determine max value for crit calculation
	maxValue := getMaxDiceValue(rollExpr)

	// Calculate success/failure
	level, isCrit, isSuccess := calculateSuccessLevel(result, target, maxValue, bonusSuccesses)

	// Format result
	var sb strings.Builder

	// Show command with bonus if present
	if bonusSuccesses > 0 {
		sb.WriteString(fmt.Sprintf("%s vs %d [+%d]:\n", rollExpr, target, bonusSuccesses))
	} else {
		sb.WriteString(fmt.Sprintf("%s vs %d:\n", rollExpr, target))
	}

	// Show the roll breakdown - only show calculation if there are operators
	if strings.ContainsAny(output, "+-*/(") {
		sb.WriteString(fmt.Sprintf("%s = %d\n", output, result))
	}

	// Show result line
	if isSuccess {
		sb.WriteString(fmt.Sprintf("%d, %d success", result, level))
		if isCrit {
			sb.WriteString(", crit!")
		}
	} else {
		sb.WriteString(fmt.Sprintf("%d, %d fail", result, level))
		if isCrit {
			sb.WriteString(", crit!")
		}
	}

	return CommandResult{
		Success: true,
		Result:  sb.String(),
	}
}

// executeMultipleVersusRoll handles multiple versus rolls (e.g., 5x(d100 vs 50))
func executeMultipleVersusRoll(args string, rng *rand.Rand) CommandResult {
	// Extract N
	idx := strings.Index(args, "x(")
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

	// Parse the versus roll
	rollExpr, target, bonusSuccesses, err := parseVersusRoll(expr)
	if err != nil {
		return CommandResult{
			Success: false,
			Result:  err.Error(),
		}
	}

	maxValue := getMaxDiceValue(rollExpr)

	// Execute N times
	var outputs []string
	var levelContributions []string
	totalSuccessLevel := 0

	for i := 0; i < n; i++ {
		output, result, err := evaluate(rollExpr, rng)
		if err != nil {
			return CommandResult{
				Success: false,
				Result:  err.Error(),
			}
		}

		level, isCrit, isSuccess := calculateSuccessLevel(result, target, maxValue, bonusSuccesses)

		// Format individual result - only show calculation if there are operators
		var line strings.Builder
		if strings.ContainsAny(output, "+-*/(") {
			line.WriteString(fmt.Sprintf("%s = %d, ", output, result))
		} else {
			line.WriteString(fmt.Sprintf("%d, ", result))
		}

		if isSuccess {
			line.WriteString(fmt.Sprintf("%d success", level))
			totalSuccessLevel += level
			levelContributions = append(levelContributions, fmt.Sprintf("%d", level))
		} else {
			line.WriteString(fmt.Sprintf("%d fail", level))
			totalSuccessLevel -= level
			levelContributions = append(levelContributions, fmt.Sprintf("-%d", level))
		}

		if isCrit {
			line.WriteString(", crit!")
		}

		outputs = append(outputs, line.String())
	}

	// Format final output
	var sb strings.Builder
	if bonusSuccesses > 0 {
		sb.WriteString(fmt.Sprintf("%dx(%s vs %d [+%d]):\n", n, rollExpr, target, bonusSuccesses))
	} else {
		sb.WriteString(fmt.Sprintf("%dx(%s vs %d):\n", n, rollExpr, target))
	}

	for _, output := range outputs {
		sb.WriteString(output)
		sb.WriteString("\n")
	}

	// Show the calculation breakdown
	calculation := strings.Join(levelContributions, " + ")
	calculation = strings.ReplaceAll(calculation, "+ -", "- ")
	sb.WriteString(fmt.Sprintf("%s = %d\n", calculation, totalSuccessLevel))
	sb.WriteString(fmt.Sprintf("Total: %d success", totalSuccessLevel))

	return CommandResult{
		Success: true,
		Result:  sb.String(),
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
