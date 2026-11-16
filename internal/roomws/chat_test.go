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
