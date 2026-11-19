package forum

// Who may do what (_prd/forum/plan.md, «Права»): every rule lives here as a pure function of the
// viewer and its target, without queries. Handlers and templates ask these instead of comparing
// fields; each rule gets rows in the table of rights_test.go.

// CanRead is reading sections, topics and posts. Guests read too; a deleted topic has its own
// rule, CanReadTopic.
func (v Viewer) CanRead() bool {
	return true
}

// CanReadTopic hides a deleted topic from all but moderators; the others get the site's 404, as
// for a topic that never was.
func (v Viewer) CanReadTopic(t Topic) bool {
	return !t.Deleted() || v.Moderator
}

// Banned: the viewer reads the forum as a guest does but sees why (block 5). A moderator is never
// banned: a ban given before the grant stops binding them.
func (v Viewer) Banned() bool {
	return v.Ban != nil && !v.Moderator
}

// writes is whether the viewer may write anything at all: signed in and not banned.
func (v Viewer) writes() bool {
	return v.SignedIn() && !v.Banned()
}

// CanStartTopic: anyone who writes, but only moderators in a section with mods_only_topics.
func (v Viewer) CanStartTopic(s Section) bool {
	return v.writes() && (!s.ModsOnlyTopics || v.Moderator)
}

// CanReply: anyone who writes, but only moderators in a closed topic. Nobody replies in a deleted
// topic, not even a moderator: its readers no longer see it.
func (v Viewer) CanReply(t Topic) bool {
	return v.writes() && !t.Deleted() && (!t.Closed || v.Moderator)
}

// SignInToStartTopic: a guest gets a link to sign in where a member could start a topic.
func (v Viewer) SignInToStartTopic(s Section) bool {
	return !v.SignedIn() && !s.ModsOnlyTopics
}

// SignInToReply: a guest gets a link to sign in where a member could reply.
func (v Viewer) SignInToReply(t Topic) bool {
	return !v.SignedIn() && !t.Deleted() && !t.Closed
}

// CanEditPost: the author edits their own post while it and its topic stand; in a closed topic and
// under a ban they don't (decision 9 of the plan), a moderator does in a closed topic. Nobody edits
// another's post, a moderator neither.
func (v Viewer) CanEditPost(t Topic, p post) bool {
	return v.ownsLivePost(t, p)
}

// CanDeletePost is CanEditPost but for the first post, which opens the topic: it goes only with
// the topic. A moderator deletes any reply in a topic that stands; another's goes through moderate
// (DeletesAsModerator).
func (v Viewer) CanDeletePost(t Topic, p post) bool {
	return !p.First() && (v.ownsLivePost(t, p) || v.Moderator && !p.Deleted() && !t.Deleted())
}

// DeletesAsModerator: deleting this post is a moderator's action, with a reason and a line in the
// log, not the author taking back their own words.
func (v Viewer) DeletesAsModerator(p post) bool {
	return v.Moderator && p.AuthorID != v.ID
}

// CanReadDeletedPosts: a moderator reads the text of a deleted post, who deleted it and why; the
// others see a line in its place.
func (v Viewer) CanReadDeletedPosts() bool {
	return v.Moderator
}

// CanQuote: whoever may reply in the topic quotes a post that is not deleted; a guest, a banned
// user, a member in a closed topic and anyone in a deleted topic get no link (task 3.2 of block 3).
func (v Viewer) CanQuote(t Topic, p post) bool {
	return v.CanReply(t) && !p.Deleted()
}

// CanSubscribe to the replies of a topic (block 6): anyone who writes, to a topic that stands. A
// closed topic still gets replies, from moderators.
func (v Viewer) CanSubscribe(t Topic) bool {
	return v.writes() && !t.Deleted()
}

func (v Viewer) ownsLivePost(t Topic, p post) bool {
	return v.writes() && p.AuthorID == v.ID && !p.Deleted() && !t.Deleted() && (!t.Closed || v.Moderator)
}

// The moderators' actions (block 5). Each goes through moderate (moderation.go), which writes the
// log.

// CanModerate is what needs no target: the menu "Moderation", the pages of sections, of the log
// and of bans, lifting a ban.
func (v Viewer) CanModerate() bool {
	return v.Moderator
}

// CanModerateTopic: rename, pin and unpin, close and open, move to a section, delete. A deleted
// topic is only restored.
func (v Viewer) CanModerateTopic(t Topic) bool {
	return v.Moderator && !t.Deleted()
}

// CanRestoreTopic brings a deleted topic back (decision 8 of the plan, changed on 2026-11-19).
func (v Viewer) CanRestoreTopic(t Topic) bool {
	return v.Moderator && t.Deleted()
}

// CanRestorePost brings back a deleted post, whoever deleted it, in a topic that stands (session B).
func (v Viewer) CanRestorePost(t Topic, p post) bool {
	return v.Moderator && p.Deleted() && !t.Deleted()
}

// CanBan the author of a post (session C): never a moderator, so never oneself.
func (v Viewer) CanBan(p post) bool {
	return v.Moderator && !p.AuthorModerator && p.AuthorID != v.ID
}
