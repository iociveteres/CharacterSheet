package commands

import (
	"math/rand"
	"strings"
	"testing"
)

func TestIsVersusRoll(t *testing.T) {
	tests := []struct {
		expr     string
		expected bool
	}{
		{"d100vs70", true},
		{"2d50+3vs77", true},
		{"d100", false},
		{"2d6+3", false},
	}

	for _, tt := range tests {
		result := isVersusRoll(tt.expr)
		if result != tt.expected {
			t.Errorf("isVersusRoll(%q) = %v, want %v", tt.expr, result, tt.expected)
		}
	}
}

func TestParseVersusRoll(t *testing.T) {
	tests := []struct {
		expr           string
		expectedRoll   string
		expectedTarget int
		shouldError    bool
	}{
		{"d100vs70", "d100", 70, false},
		{"2d50+3vs77", "2d50+3", 77, false},
		{"d20vs15", "d20", 15, false},
		{"invalid", "", 0, true},
		{"d100vsabc", "", 0, true},
	}

	for _, tt := range tests {
		roll, target, err := parseVersusRoll(tt.expr)
		if tt.shouldError {
			if err == nil {
				t.Errorf("parseVersusRoll(%q) should have errored", tt.expr)
			}
		} else {
			if err != nil {
				t.Errorf("parseVersusRoll(%q) unexpected error: %v", tt.expr, err)
			}
			if roll != tt.expectedRoll {
				t.Errorf("parseVersusRoll(%q) roll = %q, want %q", tt.expr, roll, tt.expectedRoll)
			}
			if target != tt.expectedTarget {
				t.Errorf("parseVersusRoll(%q) target = %d, want %d", tt.expr, target, tt.expectedTarget)
			}
		}
	}
}

func TestCalculateSuccessLevel(t *testing.T) {
	tests := []struct {
		roll       int
		target     int
		maxValue   int
		expLevel   int
		expCrit    bool
		expSuccess bool
	}{
		// Critical successes (1-5 for d100) - still calculate normal levels
		{1, 50, 100, 5, true, true}, // 49 below = 5 levels
		{3, 50, 100, 5, true, true}, // 47 below = 5 levels
		{5, 50, 100, 5, true, true}, // 45 below = 5 levels

		// Critical failures (96-100 for d100) - still calculate normal levels
		{96, 50, 100, 5, true, false},  // 46 above = 5 levels
		{99, 50, 100, 5, true, false},  // 49 above = 5 levels
		{100, 50, 100, 6, true, false}, // 50 above = 6 levels

		// Critical but different levels based on target
		{96, 81, 100, 2, true, false}, // 15 above = 2 levels, is crit
		{5, 81, 100, 8, true, true},   // 76 below = 8 levels, is crit

		// Normal successes
		{50, 50, 100, 1, false, true}, // Exact match
		{40, 50, 100, 2, false, true}, // 10 below
		{30, 50, 100, 3, false, true}, // 20 below
		{49, 50, 100, 1, false, true}, // 1 below
		{41, 50, 100, 1, false, true}, // 9 below (not full 10)

		// Normal failures
		{51, 50, 100, 1, false, false}, // 1 above
		{60, 50, 100, 2, false, false}, // 10 above
		{70, 50, 100, 3, false, false}, // 20 above
		{59, 50, 100, 1, false, false}, // 9 above (not full 10)
	}

	for _, tt := range tests {
		level, isCrit, isSuccess := calculateSuccessLevel(tt.roll, tt.target, tt.maxValue)
		if level != tt.expLevel || isCrit != tt.expCrit || isSuccess != tt.expSuccess {
			t.Errorf("calculateSuccessLevel(%d, %d, %d) = (%d, %v, %v), want (%d, %v, %v)",
				tt.roll, tt.target, tt.maxValue,
				level, isCrit, isSuccess,
				tt.expLevel, tt.expCrit, tt.expSuccess)
		}
	}
}

func TestGetMaxDiceValue(t *testing.T) {
	tests := []struct {
		expr     string
		expected int
	}{
		{"d100", 100},
		{"2d100", 100},
		{"d20", 20},
		{"3d6", 6},
		{"d6+2", 6},
		{"complex", 100}, // Default
	}

	for _, tt := range tests {
		result := getMaxDiceValue(tt.expr)
		if result != tt.expected {
			t.Errorf("getMaxDiceValue(%q) = %d, want %d", tt.expr, result, tt.expected)
		}
	}
}

func TestExecuteSingleVersusRoll(t *testing.T) {
	// Use a fixed seed for deterministic testing
	rng := rand.New(rand.NewSource(12345))

	tests := []struct {
		args        string
		shouldError bool
		checkOutput func(string) bool
	}{
		{
			args:        "d100vs70",
			shouldError: false,
			checkOutput: func(s string) bool {
				return strings.Contains(s, "vs 70") &&
					(strings.Contains(s, "success") || strings.Contains(s, "fail"))
			},
		},
		{
			args:        "2d50+3vs77",
			shouldError: false,
			checkOutput: func(s string) bool {
				return strings.Contains(s, "vs 77") && strings.Contains(s, "=")
			},
		},
		{
			args:        "invalidvs",
			shouldError: true,
			checkOutput: func(s string) bool { return true },
		},
	}

	for _, tt := range tests {
		result := executeSingleVersusRoll(tt.args, rng)
		if tt.shouldError && result.Success {
			t.Errorf("executeSingleVersusRoll(%q) should have failed", tt.args)
		}
		if !tt.shouldError {
			if !result.Success {
				t.Errorf("executeSingleVersusRoll(%q) unexpected error: %s", tt.args, result.Result)
			}
			if !tt.checkOutput(result.Result) {
				t.Errorf("executeSingleVersusRoll(%q) output check failed: %s", tt.args, result.Result)
			}
		}
	}
}

func TestExecuteMultipleVersusRoll(t *testing.T) {
	rng := rand.New(rand.NewSource(12345))

	tests := []struct {
		args        string
		shouldError bool
		checkOutput func(string) bool
	}{
		{
			args:        "5x(d100vs50)",
			shouldError: false,
			checkOutput: func(s string) bool {
				return strings.Contains(s, "5x(d100 vs 50)") &&
					strings.Contains(s, "Total:") &&
					strings.Count(s, "\n") >= 5 // At least 5 roll results
			},
		},
		{
			args:        "3x(2d50+10vs80)",
			shouldError: false,
			checkOutput: func(s string) bool {
				return strings.Contains(s, "3x(") && strings.Contains(s, "Total:")
			},
		},
		{
			args:        "200x(d100vs50)", // Too many
			shouldError: true,
			checkOutput: func(s string) bool { return true },
		},
	}

	for _, tt := range tests {
		result := executeMultipleVersusRoll(tt.args, rng)
		if tt.shouldError && result.Success {
			t.Errorf("executeMultipleVersusRoll(%q) should have failed", tt.args)
		}
		if !tt.shouldError {
			if !result.Success {
				t.Errorf("executeMultipleVersusRoll(%q) unexpected error: %s", tt.args, result.Result)
			}
			if !tt.checkOutput(result.Result) {
				t.Errorf("executeMultipleVersusRoll(%q) output check failed: %s", tt.args, result.Result)
			}
		}
	}
}

func TestExecuteVersusRollCommand(t *testing.T) {
	rng := rand.New(rand.NewSource(12345))

	// Test single versus roll
	result := executeVersusRollCommand("d100vs50", rng)
	if !result.Success {
		t.Errorf("Single versus roll failed: %s", result.Result)
	}

	// Test multiple versus roll
	result = executeVersusRollCommand("3x(d100vs50)", rng)
	if !result.Success {
		t.Errorf("Multiple versus roll failed: %s", result.Result)
	}
	if !strings.Contains(result.Result, "Total:") {
		t.Errorf("Multiple versus roll missing total: %s", result.Result)
	}
}

func TestIntegrationWithExecuteRollCommandWithRand(t *testing.T) {
	rng := rand.New(rand.NewSource(12345))

	// Test that versus rolls are properly detected and routed
	result := executeRollCommandWithRand("d100 vs 70", rng)
	if !result.Success {
		t.Errorf("Integration test failed: %s", result.Result)
	}
	if !strings.Contains(result.Result, "vs 70") {
		t.Errorf("Integration test output missing 'vs 70': %s", result.Result)
	}

	// Test normal rolls still work
	result = executeRollCommandWithRand("2d6+3", rng)
	if !result.Success {
		t.Errorf("Normal roll failed: %s", result.Result)
	}
	if strings.Contains(result.Result, "vs") {
		t.Errorf("Normal roll should not contain 'vs': %s", result.Result)
	}
}
