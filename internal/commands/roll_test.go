package commands

import (
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestExecuteRollCommandOutputFormat(t *testing.T) {
	tests := []struct {
		name        string
		args        string
		seed        int64
		wantSuccess bool
		wantPattern    string
		wantMinTotal   int
		wantMaxTotal   int
		checkSortOrder bool
	}{
		{
			name:         "Single d6",
			args:         "d6",
			seed:         1,
			wantSuccess:  true,
			wantPattern:  `^d6:\s*\d+\s*=\s*\d+$`,
			wantMinTotal: 1,
			wantMaxTotal: 6,
		},
		{
			name:         "Single d3",
			args:         "1d3",
			seed:         2,
			wantSuccess:  true,
			wantPattern:  `^1d3:\s*\d+\s*=\s*\d+$`,
			wantMinTotal: 1,
			wantMaxTotal: 3,
		},
		{
			name:         "d100 with positive modifier",
			args:         "d100+32",
			seed:         10,
			wantSuccess:  true,
			wantPattern:  `^d100\+32:(?s).*=\s*\d+$`,
			wantMinTotal: 33,
			wantMaxTotal: 132,
		},
		{
			name:         "d100 with negative modifier",
			args:         "d100-15",
			seed:         10,
			wantSuccess:  true,
			wantPattern:  `^d100-15:(?s).*=\s*-?\d+$`,
			wantMinTotal: -14,
			wantMaxTotal: 85,
		},
		{
			name:         "Two d100",
			args:         "2d100",
			seed:         5,
			wantSuccess:  true,
			wantPattern:  `^2d100:(?s).*=\s*\d+$`,
			wantMinTotal: 2,
			wantMaxTotal: 200,
		},
		{
			name:        "4d6 keep 3",
			args:        "4d6k3",
			seed:        20,
			wantSuccess: true,
			// Should have 3 numbers added and 1 in parentheses
			wantPattern:  `^4d6k3:(?s).*\(\d+\).*=\s*\d+$`,
			wantMinTotal: 3,
			wantMaxTotal: 18,
		},
		{
			name:           "Repeated roll 4x(25+2d10)",
			args:           "4x(25+2d10)",
			seed:           42,
			wantSuccess:    true,
			wantPattern:    `^4x\(25\+2d10\):`,
			wantMinTotal:   27, // 25 + 1 + 1
			wantMaxTotal:   45, // 25 + 10 + 10
			checkSortOrder: true,
		},
		{
			name:           "Repeated roll 2x(d20)",
			args:           "2x(d20)",
			seed:           42,
			wantSuccess:    true,
			wantPattern:    `^2x\(d20\):`,
			checkSortOrder: true,
		},
		{
			name:        "Empty args",
			args:        "",
			seed:        1,
			wantSuccess: false,
			wantPattern: `Usage:`,
		},
		{
			name:        "Invalid notation",
			args:        "invalid",
			seed:        1,
			wantSuccess: false,
			wantPattern: `invalid`,
		},
		{
			name:         "Keep more than rolled - keeps all",
			args:         "2d6k3",
			seed:         1,
			wantSuccess:  true,
			wantPattern:  `^2d6k3:(?s).*=\s*\d+$`,
			wantMinTotal: 2,
			wantMaxTotal: 12,
		},
		{
			name:         "Multiple dice with modifier",
			args:         "3d6+5",
			seed:         30,
			wantSuccess:  true,
			wantPattern:  `^3d6\+5:(?s).*=\s*\d+$`,
			wantMinTotal: 8,
			wantMaxTotal: 23,
		},
		{
			name:           "Repeated roll 3x(1d4+2)",
			args:           "3x(1d4+2)",
			seed:           50,
			wantSuccess:    true,
			wantPattern:    `^3x\(1d4\+2\):`,
			checkSortOrder: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rng := rand.New(rand.NewSource(tt.seed))
			result := executeRollCommandWithRand(tt.args, rng)

			// Verbose logging - only shows with -v flag
			t.Logf("Input: %q (seed=%d)", tt.args, tt.seed)
			t.Logf("Output: %q", result.Result)
			t.Logf("Success: %v", result.Success)

			if result.Success != tt.wantSuccess {
				t.Errorf("executeRollCommand(%q).Success = %v, want %v",
					tt.args, result.Success, tt.wantSuccess)
			}

			// Check pattern match
			matched, err := regexp.MatchString(tt.wantPattern, result.Result)
			if err != nil {
				t.Fatalf("Invalid pattern: %v", err)
			}
			if !matched {
				t.Errorf("executeRollCommand(%q).Result = %q, doesn't match pattern %q",
					tt.args, result.Result, tt.wantPattern)
			}

			// Check total is within valid range for repeated rolls
			if tt.checkSortOrder && tt.wantSuccess && tt.wantMaxTotal > 0 {
				lines := strings.Split(result.Result, "\n")
				if len(lines) >= 2 {
					sortedLine := lines[len(lines)-1]
					nums := parseSortedNumbers(sortedLine)
					t.Logf("Sorted results: %v", nums)
					for _, num := range nums {
						if num < tt.wantMinTotal || num > tt.wantMaxTotal {
							t.Errorf("executeRollCommand(%q) value %d out of range [%d, %d]",
								tt.args, num, tt.wantMinTotal, tt.wantMaxTotal)
						}
					}
				}
			}

			// Check total is within valid range for single rolls
			if !tt.checkSortOrder && tt.wantSuccess && tt.wantMaxTotal > 0 {
				// Extract the final total from the result
				re := regexp.MustCompile(`=\s*(-?\d+)`)
				matches := re.FindStringSubmatch(result.Result)
				if len(matches) > 1 {
					total, _ := strconv.Atoi(matches[1])
					t.Logf("Total: %d (valid range: [%d, %d])", total, tt.wantMinTotal, tt.wantMaxTotal)
					if total < tt.wantMinTotal || total > tt.wantMaxTotal {
						t.Errorf("executeRollCommand(%q) total = %d, want between %d and %d",
							tt.args, total, tt.wantMinTotal, tt.wantMaxTotal)
					}
				}
			}

			// Check sort order for repeated rolls
			if tt.checkSortOrder && tt.wantSuccess {
				lines := strings.Split(result.Result, "\n")
				if len(lines) >= 2 {
					sortedLine := lines[len(lines)-1]
					nums := parseSortedNumbers(sortedLine)
					if !isSorted(nums) {
						t.Errorf("executeRollCommand(%q) results not sorted: %v",
							tt.args, nums)
					}
				}
			}
		})
	}
}

func TestExecuteRollCommandStructure(t *testing.T) {
	tests := []struct {
		name      string
		args      string
		seed      int64
		checkFunc func(t *testing.T, result string)
	}{
		{
			name: "Single die shows single value",
			args: "d20",
			seed: 100,
			checkFunc: func(t *testing.T, result string) {
				t.Logf("Result: %q", result)
				// Should have format: d20: X = X (same value twice)
				re := regexp.MustCompile(`^d20:\s*(\d+)\s*=\s*(\d+)$`)
				matches := re.FindStringSubmatch(result)
				if len(matches) != 3 {
					t.Errorf("Result doesn't match expected format: %q", result)
					return
				}
				if matches[1] != matches[2] {
					t.Errorf("Values should match for single die: %q", result)
				}
			},
		},
		{
			name: "2d100 shows both rolls",
			args: "2d100",
			seed: 123,
			checkFunc: func(t *testing.T, result string) {
				t.Logf("Result: %q", result)
				// Should have format: 2d100: X + Y = Z
				re := regexp.MustCompile(`^2d100:\s*(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)$`)
				matches := re.FindStringSubmatch(result)
				if len(matches) != 4 {
					t.Errorf("Result doesn't match expected format: %q", result)
					return
				}
				roll1, _ := strconv.Atoi(matches[1])
				roll2, _ := strconv.Atoi(matches[2])
				total, _ := strconv.Atoi(matches[3])
				t.Logf("Rolls: %d + %d = %d", roll1, roll2, total)
				if roll1+roll2 != total {
					t.Errorf("Sum mismatch: %d + %d != %d", roll1, roll2, total)
				}
			},
		},
		{
			name: "d20 with modifier shows calculation",
			args: "d20+5",
			seed: 200,
			checkFunc: func(t *testing.T, result string) {
				t.Logf("Result: %q", result)
				// Should have format: d20+5: X +5 = Y (allow flexible spacing)
				re := regexp.MustCompile(`^d20\+5:\s*(\d+)\s*\+\s*5\s*=\s*(\d+)$`)
				matches := re.FindStringSubmatch(result)
				if len(matches) != 3 {
					t.Errorf("Result doesn't match expected format: %q", result)
					return
				}
				roll, _ := strconv.Atoi(matches[1])
				total, _ := strconv.Atoi(matches[2])
				t.Logf("Roll: %d +5 = %d", roll, total)
				if roll+5 != total {
					t.Errorf("Sum mismatch: %d + 5 != %d", roll, total)
				}
			},
		},
		{
			name: "4d6k3 shows dropped die in parentheses",
			args: "4d6k3",
			seed: 456,
			checkFunc: func(t *testing.T, result string) {
				t.Logf("Result: %q", result)
				// Should have exactly one number in parentheses
				re := regexp.MustCompile(`\((\d+)\)`)
				matches := re.FindAllString(result, -1)
				if len(matches) != 1 {
					t.Errorf("Expected 1 dropped die, found %d in: %q", len(matches), result)
				}
			},
		},
		{
			name: "3x(d20) has 3 lines and sorted output",
			args: "3x(d20)",
			seed: 789,
			checkFunc: func(t *testing.T, result string) {
				t.Logf("Result:\n%s", result)
				lines := strings.Split(strings.TrimSpace(result), "\n")
				// First line is "3x(d20):", then 3 result lines, then sorted line
				if len(lines) < 5 {
					t.Errorf("Expected at least 5 lines (header + 3 results + sorted), got %d", len(lines))
					return
				}

				// Check sorted output (last line)
				nums := parseSortedNumbers(lines[len(lines)-1])
				t.Logf("Sorted numbers: %v", nums)
				if len(nums) != 3 {
					t.Errorf("Expected 3 sorted numbers, got %d", len(nums))
				}
				if !isSorted(nums) {
					t.Errorf("Numbers not sorted: %v", nums)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("Testing: %q (seed=%d)", tt.args, tt.seed)
			rng := rand.New(rand.NewSource(tt.seed))
			result := executeRollCommandWithRand(tt.args, rng)

			if !result.Success {
				t.Fatalf("Expected successful roll, got: %q", result.Result)
			}

			tt.checkFunc(t, result.Result)
		})
	}
}

func TestExecuteRollCommandMultipleDice(t *testing.T) {
	tests := []struct {
		name         string
		args         string
		seed         int64
		wantSuccess  bool
		wantPattern  string
		wantMinTotal int
		wantMaxTotal int
	}{
		{
			name:         "d6 + d12 + 1",
			args:         "d6+d12+1",
			seed:         100,
			wantSuccess:  true,
			wantPattern:  `^d6\+d12\+1:.*=\s*\d+$`,
			wantMinTotal: 3,  // 1 + 1 + 1
			wantMaxTotal: 19, // 6 + 12 + 1
		},
		{
			name:         "d6 + d12 + 1 with spaces",
			args:         "d6 + d12 + 1",
			seed:         101,
			wantSuccess:  true,
			wantPattern:  `^d6\+d12\+1:.*=\s*\d+$`,
			wantMinTotal: 3,
			wantMaxTotal: 19,
		},
		{
			name:         "2d6 + d12",
			args:         "2d6+d12",
			seed:         102,
			wantSuccess:  true,
			wantPattern:  `^2d6\+d12:.*=\s*\d+$`,
			wantMinTotal: 3,  // 1 + 1 + 1
			wantMaxTotal: 24, // 6 + 6 + 12
		},
		{
			name:         "d20 + 5 + d4",
			args:         "d20+5+d4",
			seed:         103,
			wantSuccess:  true,
			wantPattern:  `^d20\+5\+d4:.*=\s*\d+$`,
			wantMinTotal: 7,  // 1 + 5 + 1
			wantMaxTotal: 29, // 20 + 5 + 4
		},
		{
			name:         "3d6 + 2d4 + 10",
			args:         "3d6+2d4+10",
			seed:         104,
			wantSuccess:  true,
			wantPattern:  `^3d6\+2d4\+10:.*=\s*\d+$`,
			wantMinTotal: 15, // 1 + 1 + 1 + 1 + 1 + 10
			wantMaxTotal: 36, // 6 + 6 + 6 + 4 + 4 + 10
		},
		{
			name:         "d100 - 10 + d6",
			args:         "d100-10+d6",
			seed:         105,
			wantSuccess:  true,
			wantPattern:  `^d100-10\+d6:.*=\s*-?\d+$`,
			wantMinTotal: -8, // 1 - 10 + 1
			wantMaxTotal: 96, // 100 - 10 + 6
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rng := rand.New(rand.NewSource(tt.seed))
			result := executeRollCommandWithRand(tt.args, rng)

			// Verbose logging
			t.Logf("Input: %q (seed=%d)", tt.args, tt.seed)
			t.Logf("Output: %q", result.Result)
			t.Logf("Success: %v", result.Success)

			if result.Success != tt.wantSuccess {
				t.Errorf("executeRollCommand(%q).Success = %v, want %v",
					tt.args, result.Success, tt.wantSuccess)
			}

			// Check pattern match
			matched, err := regexp.MatchString(tt.wantPattern, result.Result)
			if err != nil {
				t.Fatalf("Invalid pattern: %v", err)
			}
			if !matched {
				t.Errorf("executeRollCommand(%q).Result = %q, doesn't match pattern %q",
					tt.args, result.Result, tt.wantPattern)
			}

			// Check total is within valid range
			if tt.wantSuccess {
				re := regexp.MustCompile(`=\s*(-?\d+)$`)
				matches := re.FindStringSubmatch(result.Result)
				if len(matches) > 1 {
					total, _ := strconv.Atoi(matches[1])
					t.Logf("Total: %d (valid range: [%d, %d])", total, tt.wantMinTotal, tt.wantMaxTotal)
					if total < tt.wantMinTotal || total > tt.wantMaxTotal {
						t.Errorf("executeRollCommand(%q) total = %d, want between %d and %d",
							tt.args, total, tt.wantMinTotal, tt.wantMaxTotal)
					}
				}
			}
		})
	}
}

func TestExecuteRollCommandValidation(t *testing.T) {
	tests := []struct {
		name        string
		args        string
		wantSuccess bool
		wantContain string
	}{
		{
			name:        "Too many dice",
			args:        "10000d6",
			wantSuccess: false,
			wantContain: "Dice count must be between 1 and 1000",
		},
		{
			name:        "Too many sides",
			args:        "1d100001",
			wantSuccess: false,
			wantContain: "Dice sides must be between 1 and 100000",
		},
		{
			name:        "Zero dice",
			args:        "0d6",
			wantSuccess: false,
			wantContain: "Dice count must be between 1 and 1000",
		},
		{
			name:        "Too many repetitions",
			args:        "1000x(d6)",
			wantSuccess: false,
			wantContain: "Repetition count must be between 1 and 100",
		},
		{
			name:        "Zero repetitions",
			args:        "0x(d6)",
			wantSuccess: false,
			wantContain: "Repetition count must be between 1 and 100",
		},
		{
			name:        "At boundary - 1000 dice",
			args:        "1000d6",
			wantSuccess: true,
			wantContain: "",
		},
		{
			name:        "At boundary - 100000 sides",
			args:        "1d100000",
			wantSuccess: true,
			wantContain: "",
		},
		{
			name:        "At boundary - 100 repetitions",
			args:        "100x(d6)",
			wantSuccess: true,
			wantContain: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("Testing validation: %q", tt.args)
			rng := rand.New(rand.NewSource(1))
			result := executeRollCommandWithRand(tt.args, rng)

			t.Logf("Result: Success=%v, Message=%q", result.Success, result.Result)

			if result.Success != tt.wantSuccess {
				t.Errorf("executeRollCommand(%q).Success = %v, want %v",
					tt.args, result.Success, tt.wantSuccess)
			}

			if tt.wantContain != "" && !strings.Contains(result.Result, tt.wantContain) {
				t.Errorf("executeRollCommand(%q).Result = %q, want to contain %q",
					tt.args, result.Result, tt.wantContain)
			}
		})
	}
}

func parseSortedNumbers(s string) []int {
	parts := strings.Split(s, ",")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if n, err := strconv.Atoi(p); err == nil {
			nums = append(nums, n)
		}
	}
	return nums
}

func isSorted(nums []int) bool {
	for i := 1; i < len(nums); i++ {
		if nums[i] < nums[i-1] {
			return false
		}
	}
	return true
}
