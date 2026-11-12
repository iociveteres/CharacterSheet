package roomws

import (
	"bytes"
	"log"
	"strings"
	"sync"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// lockedBuffer is a log the handler goroutines write and the test reads.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// Stage 1 of the shape check (_prd/robustness/plan.md, 2б): an edit off the
// shape of the content is written as before, and the info log names its
// type, path and value kind, but not the value.
func TestOffShapeEditIsWrittenAndLogged(t *testing.T) {
	sheets := &audienceSheets{
		room:       map[int]int{10: 1},
		visibility: map[int]models.SheetVisibility{10: models.VisibilityEveryoneCanEdit},
	}
	server, dial := serveRoom(t, models.Models{CharacterSheets: sheets})
	var infoLog lockedBuffer
	server.InfoLog = log.New(&infoLog, "", 0)
	owner := dial(ownerID)

	owner.send(`{"type":"change","eventID":"e1","sheetID":"10","path":"talents.list.items.t1.name","change":"Iron Will"}`)
	if resp := owner.expect("response", "e1"); resp["OK"] != true {
		t.Fatalf("got %v, want OK", resp)
	}
	if got := infoLog.String(); got != "" {
		t.Fatalf("an edit that fits logged %q", got)
	}

	owner.send(`{"type":"change","eventID":"e2","sheetID":"10","path":"talents.list.items.t1.name","change":{"secret":"Hatred"}}`)
	if resp := owner.expect("response", "e2"); resp["OK"] != true {
		t.Fatalf("got %v, want OK: stage 1 only logs", resp)
	}
	if got := sheets.savedSheets(); len(got) != 2 {
		t.Fatalf("saved %v, want both edits written", got)
	}
	got := infoLog.String()
	for _, want := range []string{"change", "sheet=10", "talents.list.items.t1.name", "string expected, got object"} {
		if !strings.Contains(got, want) {
			t.Errorf("log %q lacks %q", got, want)
		}
	}
	if strings.Contains(got, "secret") || strings.Contains(got, "Hatred") {
		t.Errorf("log %q holds the value", got)
	}
}
