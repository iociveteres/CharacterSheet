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
