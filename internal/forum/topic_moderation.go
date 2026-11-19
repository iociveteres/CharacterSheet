package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5"
)

// The reason of a moderator's action, in characters (decision 5 of the plan).
const reasonMaxChars = 500

// topicAction is a moderator's action on a topic, the last segment of its page
// /forum/topic/{id}/mod/{action}. Each page is its form with an optional reason; the one of delete
// is also the step that confirms it.
type topicAction string

const (
	topicRename  topicAction = "rename"
	topicPin     topicAction = "pin"
	topicUnpin   topicAction = "unpin"
	topicClose   topicAction = "close"
	topicOpen    topicAction = "open"
	topicMove    topicAction = "move"
	topicDelete  topicAction = "delete"
	topicRestore topicAction = "restore"
)

func (a topicAction) known() bool {
	switch a {
	case topicRename, topicPin, topicUnpin, topicClose, topicOpen, topicMove, topicDelete, topicRestore:
		return true
	}
	return false
}

// allowed asks rights.go whether the viewer may take the action on the topic.
func (a topicAction) allowed(v Viewer, t Topic) bool {
	if a == topicRestore {
		return v.CanRestoreTopic(t)
	}
	return a.known() && v.CanModerateTopic(t)
}

// title is the heading of the action's page.
func (a topicAction) title(lang string) string {
	switch a {
	case topicRename:
		return i18n.T(lang, "forum.moderation.renameTitle")
	case topicPin:
		return i18n.T(lang, "forum.moderation.pinTitle")
	case topicUnpin:
		return i18n.T(lang, "forum.moderation.unpinTitle")
	case topicClose:
		return i18n.T(lang, "forum.moderation.close")
	case topicOpen:
		return i18n.T(lang, "forum.moderation.open")
	case topicMove:
		return i18n.T(lang, "forum.moderation.moveTitle")
	case topicDelete:
		return i18n.T(lang, "forum.moderation.deleteTopic")
	default:
		return i18n.T(lang, "forum.moderation.restoreTopic")
	}
}

// submit is the button of the action's form.
func (a topicAction) submit(lang string) string {
	switch a {
	case topicRename:
		return i18n.T(lang, "common.rename")
	case topicPin:
		return i18n.T(lang, "forum.moderation.pin")
	case topicUnpin:
		return i18n.T(lang, "forum.moderation.unpin")
	case topicDelete:
		return i18n.T(lang, "common.delete")
	case topicRestore:
		return i18n.T(lang, "forum.moderation.restore")
	default:
		return a.title(lang)
	}
}

// modForm is what the form of a moderator's action sends: a reason always, a title to rename, a
// section to move to.
type modForm struct {
	Title     string
	SectionID int
	Reason    string
	// Duration is the term of a ban, a banTerm.
	Duration string
	validator.Validator
}

func readModForm(r *http.Request) (modForm, error) {
	if err := r.ParseForm(); err != nil {
		return modForm{}, err
	}
	// An id that is no number is no section: checkSection says so.
	section, _ := strconv.Atoi(r.PostForm.Get("section"))
	return modForm{
		Title:     strings.TrimSpace(r.PostForm.Get("title")),
		SectionID: section,
		Reason:    strings.TrimSpace(r.PostForm.Get("reason")),
		Duration:  r.PostForm.Get("duration"),
	}, nil
}

// reasonField is the dot of the template "forum-mod-reason".
type reasonField struct {
	Lang string
	Form modForm
	// Required is the reason of a ban, which its user reads (decision 10 of the plan).
	Required bool
}

// ReasonField is the reason of a moderator's form: {{template "forum-mod-reason" ($.ReasonField .Form)}}.
func (v view) ReasonField(form modForm) reasonField {
	return reasonField{Lang: v.Lang, Form: form}
}

// RequiredReason is the reason field of the ban's form.
func (v view) RequiredReason(form modForm) reasonField {
	return reasonField{Lang: v.Lang, Form: form, Required: true}
}

func (m *modForm) checkReason(lang string) {
	m.Check(validator.MaxChars(m.Reason, reasonMaxChars), "reason",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": reasonMaxChars}))
}


func (m *modForm) checkSection(lang string, sections []Section, current int) {
	for _, s := range sections {
		if s.ID == m.SectionID {
			m.Check(s.ID != current, "section", i18n.T(lang, "forum.moderation.sameSection"))
			return
		}
	}
	m.AddError("section", i18n.T(lang, "forum.moderation.noSection"))
}

type topicModData struct {
	view
	Topic   topicPage
	Action  topicAction
	Heading string
	Submit  string
	// Sections are the choice of move.
	Sections []Section
	Form     modForm
}

// moderateTopic is the page of a moderator's action on a topic and the address its form posts to.
// A guest goes to sign in and back; a topic the viewer cannot read is not found, an action they may
// not take gets 403. Done, the browser goes back to the topic: a moderator still reads a deleted one.
func (f *Forum) moderateTopic(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	action := topicAction(r.PathValue("action"))
	if !ok || !action.known() {
		f.host.NotFound(w, r)
		return
	}
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return
	}
	t, err := f.loadTopic(r.Context(), id, v.Viewer.ID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(t.Topic) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if !action.allowed(v.Viewer, t.Topic) {
		forbidden(w)
		return
	}
	data := topicModData{
		view:    v,
		Topic:   t,
		Action:  action,
		Heading: action.title(v.Lang),
		Submit:  action.submit(v.Lang),
		Form:    modForm{Title: t.Title, SectionID: t.SectionID},
	}
	if action == topicMove {
		if data.Sections, err = f.sectionList(r.Context()); err != nil {
			f.host.ServerError(w, r, err)
			return
		}
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readModForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		switch action {
		case topicRename:
			checkTitle(&form.Validator, form.Title, v.Lang)
		case topicMove:
			form.checkSection(v.Lang, data.Sections, t.SectionID)
		}
		form.checkReason(v.Lang)
		if form.Valid() {
			entry, change := topicChange(action, t.Topic, form, v.Viewer.ID, v.Now)
			if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change); err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, t.URL(), http.StatusSeeOther)
			return
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	f.render(w, r, status, "topic_mod.html", data, Page{Title: data.Heading, NoIndex: true})
}

// topicChange is the log entry and the change of an action on the topic. None of them touches
// posts, so none recounts the topic: a deleted topic keeps its counters for when it is restored,
// and the lists leave it out by deleted_at.
func topicChange(a topicAction, t Topic, form modForm, by int, at time.Time) (modEntry, modChange) {
	e := modEntry{TopicID: t.ID, Reason: form.Reason}
	// set changes a column of a topic that stands, unless it is so already.
	set := func(column string, value bool) modChange {
		return func(ctx context.Context, tx pgx.Tx, _ *modEntry) error {
			tag, err := tx.Exec(ctx, `UPDATE forum_topics SET `+column+` = $2
				WHERE id = $1 AND `+column+` <> $2 AND deleted_at IS NULL`, t.ID, value)
			return changed(tag.RowsAffected(), err)
		}
	}
	switch a {
	case topicRename:
		e.Action = actionRenameTopic
		return e, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
			var old string
			err := tx.QueryRow(ctx, `
				UPDATE forum_topics t SET title = $2
				FROM (SELECT id, title FROM forum_topics WHERE id = $1 FOR UPDATE) o
				WHERE t.id = o.id AND o.title <> $2 AND t.deleted_at IS NULL
				RETURNING o.title`, t.ID, form.Title).Scan(&old)
			if errors.Is(err, pgx.ErrNoRows) {
				return errNoChange
			}
			e.Data["title"] = old
			return err
		}
	case topicPin, topicUnpin:
		e.Action = actionPinTopic
		if a == topicUnpin {
			e.Action = actionUnpinTopic
		}
		return e, set("pinned", a == topicPin)
	case topicClose, topicOpen:
		e.Action = actionCloseTopic
		if a == topicOpen {
			e.Action = actionOpenTopic
		}
		return e, set("closed", a == topicClose)
	case topicMove:
		e.Action, e.SectionID = actionMoveTopic, form.SectionID
		return e, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
			var from int
			err := tx.QueryRow(ctx, `
				UPDATE forum_topics t SET section_id = $2
				FROM (SELECT id, section_id FROM forum_topics WHERE id = $1 FOR UPDATE) o
				WHERE t.id = o.id AND o.section_id <> $2 AND t.deleted_at IS NULL
				RETURNING o.section_id`, t.ID, form.SectionID).Scan(&from)
			if errors.Is(err, pgx.ErrNoRows) {
				return errNoChange
			}
			e.Data["fromSection"] = from
			return err
		}
	case topicDelete:
		e.Action = actionDeleteTopic
		return e, func(ctx context.Context, tx pgx.Tx, _ *modEntry) error {
			tag, err := tx.Exec(ctx, `
				UPDATE forum_topics SET deleted_at = $2, deleted_by = $3 WHERE id = $1 AND deleted_at IS NULL`,
				t.ID, at, by)
			return changed(tag.RowsAffected(), err)
		}
	default:
		e.Action = actionRestoreTopic
		return e, func(ctx context.Context, tx pgx.Tx, _ *modEntry) error {
			tag, err := tx.Exec(ctx, `
				UPDATE forum_topics SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
				t.ID)
			return changed(tag.RowsAffected(), err)
		}
	}
}

// changed turns an update of no row into errNoChange.
func changed(rows int64, err error) error {
	if err == nil && rows == 0 {
		return errNoChange
	}
	return err
}

// sectionList is every section in the order of the home, for a choice of one.
func (f *Forum) sectionList(ctx context.Context) ([]Section, error) {
	rows, err := f.db.Query(ctx, `
		SELECT id, name, description, position, mods_only_topics FROM forum_sections ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Section])
}
