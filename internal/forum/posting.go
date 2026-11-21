package forum

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5"
)

// Lengths of decision 5 of the plan, in characters.
const (
	titleMinChars = 3
	titleMaxChars = 120
	bodyMaxChars  = 20000
)

// postForm is what the new topic, reply and edit forms send; on an error the page shows it again
// with the errors by field name.
type postForm struct {
	Title string
	Body  string
	// Preview is the Preview tab open: the body rendered in the field's place, the text in a hidden
	// field (design/decisions.md, 18).
	Preview bool
	// tab: a tab of the form was pressed, Preview or back to Text. The form comes back on that
	// tab and nothing is written, the limit of how often one writes is not spent.
	tab bool
	validator.Validator
}

// readPostForm reads the fields of the form; the title loses its outer spaces, the body is kept as
// typed: leading spaces mean something in Markdown.
func readPostForm(r *http.Request) (postForm, error) {
	if err := r.ParseForm(); err != nil {
		return postForm{}, err
	}
	preview := r.PostForm.Has("preview")
	return postForm{
		Title:   strings.TrimSpace(r.PostForm.Get("title")),
		Body:    r.PostForm.Get("body"),
		Preview: preview,
		tab:     preview || r.PostForm.Has("write"),
	}, nil
}

// tabStatus is the status of a form that comes back from its tab. A body over the length is not
// rendered: the form stays on the Text tab with the error.
func (p *postForm) tabStatus(lang string) int {
	if !validator.MaxChars(p.Body, bodyMaxChars) {
		p.Preview = false
		p.AddError("body", i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": bodyMaxChars}))
		return http.StatusUnprocessableEntity
	}
	return http.StatusOK
}

func (p *postForm) checkTitle(lang string) {
	checkTitle(&p.Validator, p.Title, lang)
}

// checkTitle puts the error of a topic's title, new or renamed, on the field "title".
func checkTitle(v *validator.Validator, title, lang string) {
	if !validator.NotBlank(title) {
		v.AddError("title", i18n.T(lang, "server.errors.form.blank"))
		return
	}
	v.Check(validator.MinChars(title, titleMinChars), "title",
		i18n.T(lang, "server.errors.form.minChars", i18n.Params{"count": titleMinChars}))
	v.Check(validator.MaxChars(title, titleMaxChars), "title",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": titleMaxChars}))
}

// checkBody counts a body of spaces and line breaks only as blank.
func (p *postForm) checkBody(lang string) {
	p.Check(validator.NotBlank(p.Body), "body", i18n.T(lang, "server.errors.form.blank"))
	p.Check(validator.MaxChars(p.Body, bodyMaxChars), "body",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": bodyMaxChars}))
}

// editor is the message field of a form for the template "forum-editor": the id of its textarea
// (the error and the preview take it as a prefix), its height, its aria-label when no label names it.
type editor struct {
	view
	ID    string
	Rows  int
	Label string
	Form  postForm
}

// Editor: {{template "forum-editor" ($.Editor "forum-reply-body" 6 (t .Lang "forum.posts.yourReply") .Form)}}.
func (v view) Editor(id string, rows int, label string, form postForm) editor {
	return editor{view: v, ID: id, Rows: rows, Label: label, Form: form}
}

// forbidden answers a signed-in viewer who sent a form the page did not offer them, as the site's
// clientError does.
func forbidden(w http.ResponseWriter) {
	http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
}

type newTopicData struct {
	view
	// Section is the one the form was opened from; Chosen is where the topic goes, among Choices:
	// the sections of its family where the viewer may start a topic. With fewer than two the form
	// has no choice and the topic goes to Section.
	Section Section
	Choices []Section
	Chosen  int
	Form    postForm
	// allowed is where the viewer may start the topic by their real rights; Choices is what the
	// form shows (view.Shown).
	allowed []Section
}

// familyOf reads the family of the section: its parent, or itself at the top, and the subsections,
// in the order of the home.
func (f *Forum) familyOf(ctx context.Context, s Section) ([]Section, error) {
	root := s.ID
	if s.ParentID != 0 {
		root = s.ParentID
	}
	rows, err := f.db.Query(ctx, `
		SELECT `+sectionColumns+` FROM forum_sections s
		LEFT JOIN forum_sections ps ON ps.id = s.parent_id
		WHERE s.id = $1 OR s.parent_id = $1
		ORDER BY `+treeOrder, root)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Section])
}

// choose reads the field "section" of a form with a choice: one of allowed, else an error under the
// field. A section of another family, or one of moderators' topics for a member, is no choice
// either: CanStartTopic picked them. A moderator out of the moderator mode is offered what a member
// is, but may still pick the others.
func (d *newTopicData) choose(r *http.Request) {
	if len(d.Choices) < 2 {
		return
	}
	id, err := strconv.Atoi(r.PostForm.Get("section"))
	for _, c := range d.allowed {
		if err == nil && c.ID == id {
			d.Chosen = id
			return
		}
	}
	d.Form.AddError("section", i18n.T(d.Lang, "forum.moderation.noSection"))
}

// newTopic is the page of the new topic form and the address it posts to. A guest goes to sign in
// and comes back here; a member in a section of moderators' topics gets 403; a topic over the
// limit of topicLimit gets the form back with 429.
func (f *Forum) newTopic(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	// Before the query: whether the section exists, the guest learns once signed in.
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return
	}
	head, err := f.loadSection(r.Context(), id, v.Viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	s := head.Section
	if !v.Viewer.CanStartTopic(s) {
		forbidden(w)
		return
	}
	data := newTopicData{view: v, Section: s, Chosen: s.ID}
	if s.ParentID != 0 || head.Subsections > 0 {
		family, err := f.familyOf(r.Context(), s)
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
		for _, c := range family {
			if v.Viewer.CanStartTopic(c) {
				data.allowed = append(data.allowed, c)
				// The page's own section stays offered: the moderator came to its form.
				if v.Shown.CanStartTopic(c) || c.ID == s.ID {
					data.Choices = append(data.Choices, c)
				}
			}
		}
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		if data.Form, err = readPostForm(r); err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		data.choose(r)
		if data.Form.tab {
			f.render(w, r, data.Form.tabStatus(v.Lang), "new_topic.html", data, Page{
				Title:   i18n.T(v.Lang, "forum.topics.new"),
				NoIndex: true,
			})
			return
		}
		data.Form.checkTitle(v.Lang)
		data.Form.checkBody(v.Lang)
		status = http.StatusUnprocessableEntity
		if data.Form.Valid() {
			next, err := f.nextTopicAt(r.Context(), v.Viewer, v.Now)
			if err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			if next.After(v.Now) {
				data.Form.AddNonFieldError(tooOften(v.Lang, next, v.Now))
				status = http.StatusTooManyRequests
			}
		}
		if data.Form.Valid() {
			_, postID, err := f.createTopic(r.Context(), data.Chosen, v.Viewer.ID, data.Form.Title, data.Form.Body, v.Now)
			if err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, postURL(postID), http.StatusSeeOther)
			return
		}
	}
	f.render(w, r, status, "new_topic.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.topics.new"),
		NoIndex: true,
	})
}

// replyLink is where the guest's link to sign in and reply leads: back to the reply form of the
// topic, on its last page, once signed in.
func (f *Forum) replyLink(w http.ResponseWriter, r *http.Request, v view) {
	t, ok := f.topicForReply(w, r, v)
	if !ok {
		return
	}
	http.Redirect(w, r, pageURL(t.URL(), pageCount(t.PostCount, postsPerPage))+"#reply", http.StatusSeeOther)
}

// replyPost adds a reply. A guest goes to sign in; a reply the viewer may not make (a closed topic
// for a member, a deleted topic for a moderator) gets 403; an error of the form shows the last page
// of the topic again with the text and 422, a reply over the limit of replyLimit with 429.
func (f *Forum) replyPost(w http.ResponseWriter, r *http.Request, v view) {
	t, ok := f.topicForReply(w, r, v)
	if !ok {
		return
	}
	if !v.Viewer.CanReply(t.Topic) {
		forbidden(w)
		return
	}
	form, err := readPostForm(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	if form.tab {
		status := form.tabStatus(v.Lang)
		f.renderTopic(w, r, v, t, pageCount(t.PostCount, postsPerPage), form, status, true)
		return
	}
	form.checkBody(v.Lang)
	if !form.Valid() {
		f.renderTopic(w, r, v, t, pageCount(t.PostCount, postsPerPage), form, http.StatusUnprocessableEntity, true)
		return
	}
	next, err := f.nextReplyAt(r.Context(), v.Viewer, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if next.After(v.Now) {
		form.AddNonFieldError(tooOften(v.Lang, next, v.Now))
		f.renderTopic(w, r, v, t, pageCount(t.PostCount, postsPerPage), form, http.StatusTooManyRequests, true)
		return
	}
	postID, err := f.reply(r.Context(), t.ID, v.Viewer.ID, form.Body, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, postURL(postID), http.StatusSeeOther)
}

// preview is the address the script of block 7 renders the Preview tab with: the body of the form
// as the topic would show it, the HTML alone. A guest and a banned user, who have no form to
// preview, get 403, a body over the length 422; the app's middleware refuses a request without
// csrf_token.
func (f *Forum) preview(w http.ResponseWriter, r *http.Request, v view) {
	if !v.Viewer.writes() {
		forbidden(w)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	body := r.PostForm.Get("body")
	if !validator.MaxChars(body, bodyMaxChars) {
		http.Error(w, http.StatusText(http.StatusUnprocessableEntity), http.StatusUnprocessableEntity)
		return
	}
	html, err := v.Markdown(body)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(html))
}

// topicForReply loads the topic of /forum/topic/{id}/reply: a guest goes to sign in and back to
// this address, a topic the viewer may not read is not found. False when it has answered.
func (f *Forum) topicForReply(w http.ResponseWriter, r *http.Request, v view) (topicPage, bool) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return topicPage{}, false
	}
	// Before the query: whether the topic exists, the guest learns once signed in.
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return topicPage{}, false
	}
	t, err := f.loadTopic(r.Context(), id, v.Viewer.ID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !v.Viewer.CanReadTopic(t.Topic) {
		f.host.NotFound(w, r)
		return topicPage{}, false
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return topicPage{}, false
	}
	return t, true
}
