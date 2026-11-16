package commands

import (
	"encoding/json"
	"flag"
	"math/rand"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite testdata/versus_results.json")

func TestSingleVersusResultData(t *testing.T) {
	var crits, doubles int
	for seed := int64(0); seed < 200; seed++ {
		r := executeSingleVersusRoll("d100vs50[+2]", rand.New(rand.NewSource(seed)))
		d := r.Data
		if d == nil || len(d.Rolls) != 1 {
			t.Fatalf("seed %d: data %+v for %q", seed, d, r.Result)
		}
		if d.Kind != ResultKindVersus || d.Expression != "d100" || d.Target != 50 || d.Bonus != 2 || d.Repeat != 0 || d.Total != nil {
			t.Errorf("seed %d: data %+v", seed, *d)
		}
		roll := d.Rolls[0]
		level, crit, success := calculateSuccessLevel(roll.Roll, 50, 100, 2)
		if roll.Output != "" || roll.Success != success || roll.Degrees != level || roll.Crit != crit || roll.Doubles != isDoubles(roll.Roll) {
			t.Errorf("seed %d: roll %+v", seed, roll)
		}
		if !strings.Contains(r.Result, "\n"+strconv.Itoa(roll.Roll)+", ") {
			t.Errorf("seed %d: result %q does not show roll %d", seed, r.Result, roll.Roll)
		}
		if crit {
			crits++
		}
		if roll.Doubles {
			doubles++
		}
	}
	if crits == 0 || doubles == 0 {
		t.Errorf("%d crits and %d doubles in 200 rolls: the seeds test neither", crits, doubles)
	}

	d := executeSingleVersusRoll("d100+10vs50", rand.New(rand.NewSource(1))).Data
	if d == nil || d.Bonus != 0 || d.Rolls[0].Output == "" || d.Rolls[0].Doubles {
		t.Errorf("a roll with a modifier has its breakdown and no doubles: %+v", d)
	}
}

func TestMultipleVersusResultData(t *testing.T) {
	r := executeMultipleVersusRoll("6x(2d50+10vs80[+1])", rand.New(rand.NewSource(3)))
	d := r.Data
	if d == nil || d.Repeat != 6 || d.Bonus != 1 || d.Expression != "2d50+10" || d.Target != 80 || len(d.Rolls) != 6 || d.Total == nil {
		t.Fatalf("data %+v for %q", d, r.Result)
	}
	total := 0
	for _, roll := range d.Rolls {
		if roll.Output == "" || roll.Doubles {
			t.Errorf("roll %+v: a breakdown and no doubles for 2d50+10", roll)
		}
		if roll.Success {
			total += roll.Degrees
		} else {
			total -= roll.Degrees
		}
	}
	if *d.Total != total || !strings.HasSuffix(r.Result, "Total: "+degreesText(abs(total), total >= 0)) {
		t.Errorf("total %d, want %d; result %q", *d.Total, total, r.Result)
	}

	// A total of 0 is still sent: only its absence tells a single roll.
	b, _ := json.Marshal(ResultData{Kind: ResultKindVersus, Repeat: 2, Total: new(int)})
	if !strings.Contains(string(b), `"total":0`) {
		t.Errorf("marshalled %s", b)
	}
}

func TestResultDataOnlyForVersus(t *testing.T) {
	for _, command := range []string{"/r 2d6+3", "/r 3x(d10)", "/r d100 vs", "/unknown"} {
		if r := ParseAndExecuteCommand(command); r.Data != nil {
			t.Errorf("%s: data %+v", command, *r.Data)
		}
	}
}

func TestAvailableCommandsInLanguage(t *testing.T) {
	en, ru := AvailableCommands("en")[0], AvailableCommands("ru")[0]
	if en.Command != "/r" || en.Description == ru.Description || en.DetailedDescription == ru.DetailedDescription {
		t.Errorf("en %+v, ru %+v", en, ru)
	}
	if strings.HasPrefix(ru.DetailedDescription, "room.") || !strings.Contains(ru.DetailedDescription, "\nd100 vs 70 — ") {
		t.Errorf("ru help %q", ru.DetailedDescription)
	}
}

// versusCase is a roll with what the server makes of it. The client renders
// the same data and must come to the same text in English
// (ui/static/js/room/commandResult.test.ts reads this file).
type versusCase struct {
	Command string      `json:"command"`
	Seed    int64       `json:"seed"`
	Result  string      `json:"result"`
	Data    *ResultData `json:"data"`
}

func TestVersusResultsGolden(t *testing.T) {
	const path = "testdata/versus_results.json"
	commands := []struct {
		command string
		seed    int64
	}{
		{"d100 vs 70", 1},
		{"d100 vs 77 [+1]", 2},
		{"2d50+3 vs 77", 3},
		{"d100 vs 1", 4},
		{"20x(d100 vs 50)", 5},
		{"3x(2d50+10 vs 80 [+1])", 6},
		{"1x(d10 vs 5)", 7},
	}
	got := make([]versusCase, len(commands))
	for i, c := range commands {
		r := executeRollCommandWithRand(c.command, rand.New(rand.NewSource(c.seed)))
		if !r.Success || r.Data == nil {
			t.Fatalf("%s: %+v", c.command, r)
		}
		got[i] = versusCase{Command: c.command, Seed: c.seed, Result: r.Result, Data: r.Data}
	}

	if *update {
		b, err := json.MarshalIndent(got, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v; run go test ./internal/commands -run Golden -update", err)
	}
	var want []versusCase
	if err := json.Unmarshal(b, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s is out of date; run go test ./internal/commands -run Golden -update", path)
	}

	// The client's test covers each part of the text only if a case has it.
	all := ""
	for _, c := range got {
		all += c.Result + "\n"
	}
	for _, part := range []string{"crit!", " fail", " success", " [+1]", "Total: ", " = "} {
		if !strings.Contains(all, part) {
			t.Errorf("no case shows %q", part)
		}
	}
}
