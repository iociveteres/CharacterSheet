package forum

import (
	"testing"
	"time"
)

// The viewers the table checks; a later block adds its own (an author, a banned user) here.
var (
	guest     = Viewer{}
	member    = Viewer{ID: 1, Name: "member", RegisteredAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	moderator = Viewer{ID: 2, Name: "moderator", RegisteredAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), Moderator: true}
)

// TestRights is the one table of the rules in rights.go: a row per viewer and target. A rule with
// a target (a section, a topic, a post) closes over it in check.
func TestRights(t *testing.T) {
	read := func(v Viewer) bool { return v.CanRead() }

	tests := []struct {
		name   string
		viewer Viewer
		check  func(Viewer) bool
		want   bool
	}{
		{"guest reads", guest, read, true},
		{"member reads", member, read, true},
		{"moderator reads", moderator, read, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.check(tt.viewer); got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}
