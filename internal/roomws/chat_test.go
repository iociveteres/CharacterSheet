package roomws

import (
	"encoding/json"
	"reflect"
	"testing"

	"charactersheet.iociveteres.net/internal/commands"
)

// A versus roll reaches the whole room with its result as data, as the
// message was stored; the result of a plain roll has no data.
func TestChatRollCarriesResultData(t *testing.T) {
	dial, _ := newEncounterRoom(t)
	sender, other := dial(playerID), dial(gmID)

	// A d1 rolls the same each time.
	const body = "/r 1d1 vs 50 [+1]\n>> Agility"
	roll, _ := json.Marshal(map[string]string{"type": "chatMessage", "eventID": "v", "messageBody": body})
	sender.send(string(roll))
	want := commands.ParseAndExecuteCommand(body)
	for _, p := range []*peer{other, sender} {
		got := p.expect("chatMessage", "v")
		var data *commands.ResultData
		b, _ := json.Marshal(got["resultData"])
		json.Unmarshal(b, &data)
		if got["commandResult"] != want.Result || data == nil || !reflect.DeepEqual(data, want.Data) {
			t.Errorf("got %v, want the result %q with data %+v", got, want.Result, want.Data)
		}
	}

	sender.send(`{"type":"chatMessage","eventID":"p","messageBody":"/r 1d1+2"}`)
	if got := other.expect("chatMessage", "p"); got["commandResult"] != "1d1+2:\n1 + 2 = 3" || got["resultData"] != nil {
		t.Errorf("got %v, want a plain result without data", got)
	}
}

// A roll from a sheet with its label as data is stored and sent to the room
// with the body cut before its ">>" lines and the label as data; a label that
// is no label leaves the body whole, as from a client without labelData.
func TestChatRollKeepsLabelAsData(t *testing.T) {
	dial, _ := newEncounterRoom(t)
	sender, other := dial(playerID), dial(gmID)
	send := func(eventID, body string, label json.RawMessage) {
		roll, _ := json.Marshal(map[string]any{"type": "chatMessage", "eventID": eventID, "messageBody": body, "labelData": label})
		sender.send(string(roll))
	}

	label := json.RawMessage(`{"n":["name:initiative"]}`)
	send("l", "/r 1d1+2\n>> Initiative", label)
	for _, p := range []*peer{other, sender} {
		got := p.expect("chatMessage", "l")
		stored, _ := json.Marshal(got["labelData"])
		if got["messageBody"] != "/r 1d1+2" || string(stored) != string(label) || got["commandResult"] != "1d1+2:\n1 + 2 = 3" {
			t.Errorf("got %v, want the body without its label, the label as data and the result of the roll", got)
		}
	}

	for _, c := range []struct {
		eventID, body string
		label         json.RawMessage
	}{
		{"bad", "/r 1d1\n>> Bolter", json.RawMessage(`{"n":["aim: full"]}`)},
		{"none", "/r 1d1\n>> Bolter", nil},
		{"no lines", "/r 1d1", label},
		{"no roll", "hello\n>> Bolter", label},
	} {
		send(c.eventID, c.body, c.label)
		if got := other.expect("chatMessage", c.eventID); got["messageBody"] != c.body || got["labelData"] != nil {
			t.Errorf("%s: got %v, want the body whole without label data", c.eventID, got)
		}
	}
}
