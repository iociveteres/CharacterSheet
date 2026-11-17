package models

import (
	"context"
	"reflect"
	"testing"

	"charactersheet.iociveteres.net/internal/commands"
)

// The result of a roll as data comes back as it was stored, from the insert
// and from the history; a message without it has none.
func TestRoomMessagesKeepResultData(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	pool := newSheetHomesTestDB(t)
	ctx := context.Background()
	m := &RoomMessagesModel{DB: pool}

	var user, room int
	if err := pool.QueryRow(ctx, `INSERT INTO users (name, email, hashed_password, created) VALUES ('roller', 'roller@example.com', '', now()) RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO rooms DEFAULT VALUES RETURNING id`).Scan(&room); err != nil {
		t.Fatal(err)
	}

	total := 0
	data := &commands.ResultData{
		Kind: commands.ResultKindVersus, Expression: "d100", Target: 50, Bonus: 1, Repeat: 2, Total: &total,
		Rolls: []commands.VersusRoll{{Roll: 11, Success: true, Degrees: 6, Doubles: true}, {Roll: 99, Degrees: 6, Crit: true}},
	}
	result := "2x(d100 vs 50 [+1]):\n…"
	created, err := m.CreateWithUsername(ctx, user, room, "/r 2x(d100 vs 50 [+1])", &result, data, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(created.Message.ResultData, data) || created.Username != "roller" {
		t.Errorf("created %+v, want the data %+v", created, data)
	}
	if _, _, err := m.Create(ctx, user, room, "hello", nil, nil, nil); err != nil {
		t.Fatal(err)
	}

	page, err := m.GetMessagePage(ctx, room, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 2 {
		t.Fatalf("page %+v", page)
	}
	roll, hello := page.Messages[0].Message, page.Messages[1].Message
	if !reflect.DeepEqual(roll.ResultData, data) || *roll.CommandResult != result {
		t.Errorf("roll %+v, want the data %+v", roll, data)
	}
	if hello.ResultData != nil || hello.CommandResult != nil {
		t.Errorf("hello %+v, want no result", hello)
	}

	initiative := &commands.ResultData{
		Kind: commands.ResultKindInitiative, Rolls: []commands.VersusRoll{},
		Initiative: []commands.InitiativeRoll{{Name: "Orcs", Expression: "1d10+1", Total: 7}},
	}
	lines := "Orcs: 1d10+1 = 7"
	if _, err := m.CreateWithUsername(ctx, user, room, "Initiative", &lines, initiative, nil); err != nil {
		t.Fatal(err)
	}
	page, err = m.GetMessagePage(ctx, room, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := page.Messages[0].Message.ResultData; !reflect.DeepEqual(got, initiative) {
		t.Errorf("initiative %+v, want %+v", got, initiative)
	}
}
