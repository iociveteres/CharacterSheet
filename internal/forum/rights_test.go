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

	deletedAt := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	news := Section{ID: 1, Name: "News", ModsOnlyTopics: true}
	questions := Section{ID: 2, Name: "Questions"}
	open := Topic{ID: 1, SectionID: questions.ID}
	closed := Topic{ID: 2, SectionID: questions.ID, Closed: true}
	deleted := Topic{ID: 3, SectionID: questions.ID, DeletedAt: &deletedAt}
	start := func(s Section) func(Viewer) bool { return func(v Viewer) bool { return v.CanStartTopic(s) } }
	reply := func(t Topic) func(Viewer) bool { return func(v Viewer) bool { return v.CanReply(t) } }
	signInToStart := func(s Section) func(Viewer) bool {
		return func(v Viewer) bool { return v.SignInToStartTopic(s) }
	}
	signInToReply := func(t Topic) func(Viewer) bool { return func(v Viewer) bool { return v.SignInToReply(t) } }
	readsTopic := func(t Topic) func(Viewer) bool { return func(v Viewer) bool { return v.CanReadTopic(t) } }

	// Posts by the member (id 1), the moderator (id 2) and someone else (id 3).
	ownReply := post{ID: 11, AuthorID: member.ID, Number: 2}
	ownFirst := post{ID: 10, AuthorID: member.ID, Number: 1}
	ownDeleted := post{ID: 12, AuthorID: member.ID, Number: 3, DeletedAt: &deletedAt}
	othersReply := post{ID: 13, AuthorID: 3, Number: 4}
	modsReply := post{ID: 14, AuthorID: moderator.ID, Number: 5}
	edit := func(t Topic, p post) func(Viewer) bool { return func(v Viewer) bool { return v.CanEditPost(t, p) } }
	del := func(t Topic, p post) func(Viewer) bool { return func(v Viewer) bool { return v.CanDeletePost(t, p) } }
	quote := func(t Topic, p post) func(Viewer) bool { return func(v Viewer) bool { return v.CanQuote(t, p) } }

	tests := []struct {
		name   string
		viewer Viewer
		check  func(Viewer) bool
		want   bool
	}{
		{"guest reads", guest, read, true},
		{"member reads", member, read, true},
		{"moderator reads", moderator, read, true},

		{"guest reads a topic", guest, readsTopic(open), true},
		{"guest reads a closed topic", guest, readsTopic(closed), true},
		{"guest reads a deleted topic", guest, readsTopic(deleted), false},
		{"member reads a deleted topic", member, readsTopic(deleted), false},
		{"moderator reads a deleted topic", moderator, readsTopic(deleted), true},

		{"guest starts a topic", guest, start(questions), false},
		{"member starts a topic", member, start(questions), true},
		{"moderator starts a topic", moderator, start(questions), true},
		{"guest starts a topic in news", guest, start(news), false},
		{"member starts a topic in news", member, start(news), false},
		{"moderator starts a topic in news", moderator, start(news), true},

		{"guest replies", guest, reply(open), false},
		{"member replies", member, reply(open), true},
		{"moderator replies", moderator, reply(open), true},
		{"guest replies in a closed topic", guest, reply(closed), false},
		{"member replies in a closed topic", member, reply(closed), false},
		{"moderator replies in a closed topic", moderator, reply(closed), true},
		{"member replies in a deleted topic", member, reply(deleted), false},
		{"moderator replies in a deleted topic", moderator, reply(deleted), false},

		{"guest signs in to start a topic", guest, signInToStart(questions), true},
		{"guest signs in to start a topic in news", guest, signInToStart(news), false},
		{"member signs in to start a topic", member, signInToStart(questions), false},
		{"guest signs in to reply", guest, signInToReply(open), true},
		{"guest signs in to reply in a closed topic", guest, signInToReply(closed), false},
		{"guest signs in to reply in a deleted topic", guest, signInToReply(deleted), false},
		{"member signs in to reply", member, signInToReply(open), false},

		{"guest edits a post", guest, edit(open, othersReply), false},
		{"author edits a reply", member, edit(open, ownReply), true},
		{"author edits the first post", member, edit(open, ownFirst), true},
		{"author edits a deleted post", member, edit(open, ownDeleted), false},
		{"author edits in a closed topic", member, edit(closed, ownReply), false},
		{"author edits in a deleted topic", member, edit(deleted, ownReply), false},
		{"member edits another's post", member, edit(open, othersReply), false},
		{"moderator edits another's post", moderator, edit(open, othersReply), false},
		{"moderator edits their post", moderator, edit(open, modsReply), true},
		{"moderator edits their post in a closed topic", moderator, edit(closed, modsReply), true},
		{"moderator edits their post in a deleted topic", moderator, edit(deleted, modsReply), false},

		{"guest deletes a post", guest, del(open, othersReply), false},
		{"author deletes a reply", member, del(open, ownReply), true},
		{"author deletes the first post", member, del(open, ownFirst), false},
		{"author deletes a deleted post", member, del(open, ownDeleted), false},
		{"author deletes in a closed topic", member, del(closed, ownReply), false},
		{"author deletes in a deleted topic", member, del(deleted, ownReply), false},
		{"member deletes another's post", member, del(open, othersReply), false},
		{"moderator deletes another's post", moderator, del(open, othersReply), false},
		{"moderator deletes their post", moderator, del(open, modsReply), true},
		{"moderator deletes their post in a closed topic", moderator, del(closed, modsReply), true},

		{"guest quotes a post", guest, quote(open, othersReply), false},
		{"member quotes another's post", member, quote(open, othersReply), true},
		{"member quotes their post", member, quote(open, ownReply), true},
		{"member quotes a deleted post", member, quote(open, ownDeleted), false},
		{"member quotes in a closed topic", member, quote(closed, othersReply), false},
		{"moderator quotes in a closed topic", moderator, quote(closed, othersReply), true},
		{"moderator quotes a deleted post", moderator, quote(open, ownDeleted), false},
		{"moderator quotes in a deleted topic", moderator, quote(deleted, othersReply), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.check(tt.viewer); got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}
