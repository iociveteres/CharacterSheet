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

// CanStartTopic: anyone signed in, but only moderators in a section with mods_only_topics.
func (v Viewer) CanStartTopic(s Section) bool {
	return v.SignedIn() && (!s.ModsOnlyTopics || v.Moderator)
}

// CanReply: anyone signed in, but only moderators in a closed topic. Nobody replies in a deleted
// topic, not even a moderator: its readers no longer see it.
func (v Viewer) CanReply(t Topic) bool {
	return v.SignedIn() && !t.Deleted() && (!t.Closed || v.Moderator)
}

// SignInToStartTopic: a guest gets a link to sign in where a member could start a topic.
func (v Viewer) SignInToStartTopic(s Section) bool {
	return !v.SignedIn() && !s.ModsOnlyTopics
}

// SignInToReply: a guest gets a link to sign in where a member could reply.
func (v Viewer) SignInToReply(t Topic) bool {
	return !v.SignedIn() && !t.Deleted() && !t.Closed
}

// CanEditPost: the author edits their own post while it and its topic stand; in a closed topic only
// a moderator edits theirs, as only a moderator replies there (decision 9 of the plan). Nobody
// edits another's post, a moderator neither. Block 5 adds the ban.
func (v Viewer) CanEditPost(t Topic, p post) bool {
	return v.ownsLivePost(t, p)
}

// CanDeletePost is CanEditPost but for the first post, which opens the topic: it goes only with
// the topic. Block 5 lets moderators delete any reply.
func (v Viewer) CanDeletePost(t Topic, p post) bool {
	return v.ownsLivePost(t, p) && !p.First()
}

// CanQuote: whoever may reply in the topic quotes a post that is not deleted; a guest, a member in
// a closed topic and anyone in a deleted topic get no link (task 3.2 of block 3).
func (v Viewer) CanQuote(t Topic, p post) bool {
	return v.CanReply(t) && !p.Deleted()
}

func (v Viewer) ownsLivePost(t Topic, p post) bool {
	return v.SignedIn() && p.AuthorID == v.ID && !p.Deleted() && !t.Deleted() && (!t.Closed || v.Moderator)
}
