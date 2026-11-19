package forum

// Who may do what (_prd/forum/plan.md, «Права»): every rule lives here as a pure function of the
// viewer and its target, without queries. Handlers and templates ask these instead of comparing
// fields; each rule gets rows in the table of rights_test.go.

// CanRead is reading sections, topics and posts. Guests read too; what is deleted gets its own
// rule with moderation (block 5).
func (v Viewer) CanRead() bool {
	return true
}
