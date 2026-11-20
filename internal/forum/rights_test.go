package forum

import (
	"slices"
	"strings"
	"testing"
	"time"
)

// The viewers the tables check. A ban of a viewer is the one loadViewer found standing.
var (
	guest     = Viewer{}
	member    = Viewer{ID: 1, Name: "member", RegisteredAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	moderator = Viewer{ID: 2, Name: "moderator", RegisteredAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), Moderator: true}
	banned    = Viewer{ID: 1, Name: "member", RegisteredAt: member.RegisteredAt, Ban: &Ban{ID: 1, Reason: "spam"}}
	// A moderator banned before the grant: the ban no longer binds them.
	bannedModerator = Viewer{ID: 2, Name: "moderator", RegisteredAt: moderator.RegisteredAt, Moderator: true, Ban: &Ban{ID: 2, Reason: "old"}}
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
	isBanned := func(v Viewer) bool { return v.Banned() }
	moderate := func(v Viewer) bool { return v.CanModerate() }
	readsDeleted := func(v Viewer) bool { return v.CanReadDeletedPosts() }
	asModerator := func(p post) func(Viewer) bool { return func(v Viewer) bool { return v.DeletesAsModerator(p) } }
	restorePost := func(t Topic, p post) func(Viewer) bool {
		return func(v Viewer) bool { return v.CanRestorePost(t, p) }
	}
	ban := func(p post) func(Viewer) bool { return func(v Viewer) bool { return v.CanBan(p) } }
	othersDeleted := post{ID: 15, AuthorID: 3, Number: 6, DeletedAt: &deletedAt}
	othersFirst := post{ID: 16, AuthorID: 3, Number: 1}
	byModerator := post{ID: 17, AuthorID: 4, Number: 7, AuthorModerator: true}

	// The user page (block 6 of extras/plan.md): the member's own (id 1), another's (id 3), a
	// moderator's other than the viewer (id 4) and the moderator's own (id 2).
	ownPage := forumUser{ID: member.ID}
	othersPage := forumUser{ID: 3}
	modsPage := forumUser{ID: 4, Moderator: true}
	moderatorsOwn := forumUser{ID: moderator.ID, Moderator: true}
	modUser := func(u forumUser) func(Viewer) bool { return func(v Viewer) bool { return v.CanModerateUser(u) } }
	actOn := func(u forumUser) func(Viewer) bool { return func(v Viewer) bool { return v.CanActOnUser(u) } }
	editAbout := func(u forumUser) func(Viewer) bool { return func(v Viewer) bool { return v.CanEditAbout(u) } }

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
		{"moderator deletes another's post", moderator, del(open, othersReply), true},
		{"moderator deletes another's post in a closed topic", moderator, del(closed, othersReply), true},
		{"moderator deletes another's first post", moderator, del(open, othersFirst), false},
		{"moderator deletes a deleted post", moderator, del(open, othersDeleted), false},
		{"moderator deletes another's post in a deleted topic", moderator, del(deleted, othersReply), false},
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

		{"guest is not banned", guest, isBanned, false},
		{"member is not banned", member, isBanned, false},
		{"member under a ban is banned", banned, isBanned, true},
		{"moderator under a ban is not banned", bannedModerator, isBanned, false},
		{"moderator under a ban starts a topic in news", bannedModerator, start(news), true},
		{"moderator under a ban replies in a closed topic", bannedModerator, reply(closed), true},
		{"banned user signs in to reply", banned, signInToReply(open), false},
		{"banned user signs in to start a topic", banned, signInToStart(questions), false},

		{"guest moderates", guest, moderate, false},
		{"member moderates", member, moderate, false},
		{"banned user moderates", banned, moderate, false},
		{"moderator moderates", moderator, moderate, true},

		{"guest reads deleted posts", guest, readsDeleted, false},
		{"member reads deleted posts", member, readsDeleted, false},
		{"banned user reads deleted posts", banned, readsDeleted, false},
		{"moderator reads deleted posts", moderator, readsDeleted, true},
		{"member deletes their post as a moderator", member, asModerator(ownReply), false},
		{"moderator deletes another's post as a moderator", moderator, asModerator(othersReply), true},
		{"moderator deletes their post as a moderator", moderator, asModerator(modsReply), false},

		{"member restores their deleted post", member, restorePost(open, ownDeleted), false},
		{"moderator restores a deleted post", moderator, restorePost(open, othersDeleted), true},
		{"moderator restores a post deleted by its author", moderator, restorePost(open, ownDeleted), true},
		{"moderator restores a post deleted in a closed topic", moderator, restorePost(closed, othersDeleted), true},
		{"moderator restores a post in a deleted topic", moderator, restorePost(deleted, othersDeleted), false},
		{"moderator restores a post that stands", moderator, restorePost(open, othersReply), false},

		{"guest bans an author", guest, ban(othersReply), false},
		{"member bans an author", member, ban(othersReply), false},
		{"moderator bans the author of a reply", moderator, ban(othersReply), true},
		{"moderator bans the author of a first post", moderator, ban(othersFirst), true},
		{"moderator bans the author of a deleted post", moderator, ban(othersDeleted), true},
		{"moderator bans a moderator", moderator, ban(byModerator), false},
		{"moderator bans themself", moderator, ban(modsReply), false},

		// The ban line, the moderators' block and its actions (avatar, «About», history): a
		// moderator on another's page (extras/decisions.md, 20).
		{"guest moderates a user", guest, modUser(othersPage), false},
		{"member moderates a user", member, modUser(othersPage), false},
		{"banned user moderates a user", banned, modUser(othersPage), false},
		{"moderator moderates a user", moderator, modUser(othersPage), true},
		{"moderator moderates another moderator", moderator, modUser(modsPage), true},
		{"moderator moderates themself", moderator, modUser(moderatorsOwn), false},
		{"banned moderator moderates a user", bannedModerator, modUser(othersPage), true},
		// Ban, remove the avatar, erase «About»: never a moderator's (the author, 2026-11-20).
		{"guest acts on a user", guest, actOn(othersPage), false},
		{"member acts on a user", member, actOn(othersPage), false},
		{"banned user acts on a user", banned, actOn(othersPage), false},
		{"moderator acts on a user", moderator, actOn(othersPage), true},
		{"moderator acts on another moderator", moderator, actOn(modsPage), false},
		{"moderator acts on themself", moderator, actOn(moderatorsOwn), false},
		{"banned moderator acts on a user", bannedModerator, actOn(othersPage), true},

		{"guest writes «About»", guest, editAbout(ownPage), false},
		{"member writes their «About»", member, editAbout(ownPage), true},
		{"member writes another's «About»", member, editAbout(othersPage), false},
		{"banned user writes their «About»", banned, editAbout(ownPage), false},
		{"moderator writes another's «About»", moderator, editAbout(othersPage), false},
		{"moderator writes their «About»", moderator, editAbout(moderatorsOwn), true},
		{"banned moderator writes their «About»", bannedModerator, editAbout(moderatorsOwn), true},
		{"guest reads deleted posts on a page", guest, readsDeleted, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.check(tt.viewer); got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

// TestRightsMatrix covers every viewer with every section and topic: guest, member, the author of
// the topic and of its reply, that author under a ban, moderator × an open section and one of
// moderators' topics × an open, closed and deleted topic. want lists the rights that hold; the
// others must not.
func TestRightsMatrix(t *testing.T) {
	deletedAt := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	author := Viewer{ID: 5, Name: "author", RegisteredAt: member.RegisteredAt}
	authorBanned := author
	authorBanned.Ban = &Ban{ID: 3, Reason: "spam"}
	viewers := map[string]Viewer{"guest": guest, "member": member, "author": author, "banned": authorBanned, "moderator": moderator}
	sections := map[string]Section{"open": {ID: 1}, "mods-only": {ID: 2, ModsOnlyTopics: true}}
	topic := func(section Section, state string) Topic {
		t := Topic{ID: 1, SectionID: section.ID, AuthorID: author.ID}
		switch state {
		case "closed":
			t.Closed = true
		case "deleted":
			t.DeletedAt = &deletedAt
		}
		return t
	}
	reply := post{ID: 2, AuthorID: author.ID, Number: 2}
	rights := map[string]func(Viewer, Section, Topic) bool{
		"read":      func(v Viewer, _ Section, t Topic) bool { return v.CanReadTopic(t) },
		"start":     func(v Viewer, s Section, _ Topic) bool { return v.CanStartTopic(s) },
		"reply":     func(v Viewer, _ Section, t Topic) bool { return v.CanReply(t) },
		"edit":      func(v Viewer, _ Section, t Topic) bool { return v.CanEditPost(t, reply) },
		"delete":    func(v Viewer, _ Section, t Topic) bool { return v.CanDeletePost(t, reply) },
		"quote":     func(v Viewer, _ Section, t Topic) bool { return v.CanQuote(t, reply) },
		"subscribe": func(v Viewer, _ Section, t Topic) bool { return v.CanSubscribe(t) },
		"moderate":  func(v Viewer, _ Section, t Topic) bool { return v.CanModerateTopic(t) },
		"restore":   func(v Viewer, _ Section, t Topic) bool { return v.CanRestoreTopic(t) },
		"ban":       func(v Viewer, _ Section, t Topic) bool { return v.CanBan(reply) },
	}

	tests := []struct {
		viewer, section, topic string
		want                   string
	}{
		{"guest", "open", "open", "read"},
		{"guest", "open", "closed", "read"},
		{"guest", "open", "deleted", ""},
		{"guest", "mods-only", "open", "read"},
		{"guest", "mods-only", "closed", "read"},
		{"guest", "mods-only", "deleted", ""},

		{"member", "open", "open", "read start reply quote subscribe"},
		{"member", "open", "closed", "read start subscribe"},
		{"member", "open", "deleted", "start"},
		{"member", "mods-only", "open", "read reply quote subscribe"},
		{"member", "mods-only", "closed", "read subscribe"},
		{"member", "mods-only", "deleted", ""},

		{"author", "open", "open", "read start reply edit delete quote subscribe"},
		{"author", "open", "closed", "read start subscribe"},
		{"author", "open", "deleted", "start"},
		{"author", "mods-only", "open", "read reply edit delete quote subscribe"},
		{"author", "mods-only", "closed", "read subscribe"},
		{"author", "mods-only", "deleted", ""},

		{"banned", "open", "open", "read"},
		{"banned", "open", "closed", "read"},
		{"banned", "open", "deleted", ""},
		{"banned", "mods-only", "open", "read"},
		{"banned", "mods-only", "closed", "read"},
		{"banned", "mods-only", "deleted", ""},

		{"moderator", "open", "open", "read start reply delete quote subscribe moderate ban"},
		{"moderator", "open", "closed", "read start reply delete quote subscribe moderate ban"},
		{"moderator", "open", "deleted", "read start restore ban"},
		{"moderator", "mods-only", "open", "read start reply delete quote subscribe moderate ban"},
		{"moderator", "mods-only", "closed", "read start reply delete quote subscribe moderate ban"},
		{"moderator", "mods-only", "deleted", "read start restore ban"},
	}
	names := make([]string, 0, len(rights))
	for name := range rights {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, tt := range tests {
		t.Run(tt.viewer+" in "+tt.section+" section, "+tt.topic+" topic", func(t *testing.T) {
			want := strings.Fields(tt.want)
			v, s := viewers[tt.viewer], sections[tt.section]
			for _, name := range names {
				if got := rights[name](v, s, topic(s, tt.topic)); got != slices.Contains(want, name) {
					t.Errorf("%s: got %v", name, got)
				}
			}
		})
	}
}
