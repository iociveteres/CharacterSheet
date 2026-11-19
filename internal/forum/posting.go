package forum

import (
	"errors"
	"net/http"
	"strings"
	"time"

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

// postForm is what the new topic and reply forms send; on an error the page shows it again with
// the errors by field name.
type postForm struct {
	Title string
	Body  string
	validator.Validator
}

// readPostForm reads the fields of the form; the title loses its outer spaces, the body is kept as
// typed: leading spaces mean something in Markdown.
func readPostForm(r *http.Request) (postForm, error) {
	if err := r.ParseForm(); err != nil {
		return postForm{}, err
	}
	return postForm{
		Title: strings.TrimSpace(r.PostForm.Get("title")),
		Body:  r.PostForm.Get("body"),
	}, nil
}

func (p *postForm) checkTitle(lang string) {
	if !validator.NotBlank(p.Title) {
		p.AddError("title", i18n.T(lang, "server.errors.form.blank"))
		return
	}
	p.Check(validator.MinChars(p.Title, titleMinChars), "title",
		i18n.T(lang, "server.errors.form.minChars", i18n.Params{"count": titleMinChars}))
	p.Check(validator.MaxChars(p.Title, titleMaxChars), "title",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": titleMaxChars}))
}

// checkBody counts a body of spaces and line breaks only as blank.
func (p *postForm) checkBody(lang string) {
	p.Check(validator.NotBlank(p.Body), "body", i18n.T(lang, "server.errors.form.blank"))
	p.Check(validator.MaxChars(p.Body, bodyMaxChars), "body",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": bodyMaxChars}))
}

// forbidden answers a signed-in viewer who sent a form the page did not offer them, as the site's
// clientError does.
func forbidden(w http.ResponseWriter) {
	http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
}

type newTopicData struct {
	view
	Section Section
	Form    postForm
}

// newTopic is the page of the new topic form and the address it posts to. A guest goes to sign in
// and comes back here; a member in a section of moderators' topics gets 403.
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
	s, _, err := f.loadSection(r.Context(), id, v.Viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if !v.Viewer.CanStartTopic(s) {
		forbidden(w)
		return
	}
	data := newTopicData{view: v, Section: s}
	if r.Method == http.MethodPost {
		if data.Form, err = readPostForm(r); err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		data.Form.checkTitle(v.Lang)
		data.Form.checkBody(v.Lang)
		if data.Form.Valid() {
			_, postID, err := f.createTopic(r.Context(), s.ID, v.Viewer.ID, data.Form.Title, data.Form.Body, time.Now())
			if err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, postURL(postID), http.StatusSeeOther)
			return
		}
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusUnprocessableEntity
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
// of the topic again with the text and 422.
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
	form.checkBody(v.Lang)
	if !form.Valid() {
		f.renderTopic(w, r, v, t, pageCount(t.PostCount, postsPerPage), form, http.StatusUnprocessableEntity)
		return
	}
	postID, err := f.reply(r.Context(), t.ID, v.Viewer.ID, form.Body, time.Now())
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, postURL(postID), http.StatusSeeOther)
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
	t, err := f.loadTopic(r.Context(), id)
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
