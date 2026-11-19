package forum

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5"
)

// The name and description of a section, in characters (decision 5 of the plan).
const (
	sectionNameMaxChars        = 60
	sectionDescriptionMaxChars = 200
)

const sectionsURL = "/forum/mod/sections"

// modOnly answers a page of /forum/mod/: a guest goes to sign in and back, anyone but a moderator
// gets 403. False when it has answered.
func (f *Forum) modOnly(w http.ResponseWriter, r *http.Request, v view) bool {
	if !v.Viewer.SignedIn() {
		f.host.RedirectToLogin(w, r)
		return false
	}
	if !v.Viewer.CanModerate() {
		forbidden(w)
		return false
	}
	return true
}

type sectionsModData struct {
	view
	Sections []Section
}

// Last is whether the i-th section ends the list: its button "down" moves nothing.
func (d sectionsModData) Last(i int) bool {
	return i == len(d.Sections)-1
}

// sectionsPage is the moderators' list of sections in the order of the home, with the buttons that
// move one up or down and the links to edit one or add another. A section is never deleted.
func (f *Forum) sectionsPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	sections, err := f.sectionList(r.Context())
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.render(w, r, http.StatusOK, "sections_mod.html", sectionsModData{view: v, Sections: sections}, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.sections"),
		NoIndex: true,
	})
}

// sectionForm is what the form of a new or edited section sends.
type sectionForm struct {
	Name           string
	Description    string
	ModsOnlyTopics bool
	validator.Validator
}

func readSectionForm(r *http.Request) (sectionForm, error) {
	if err := r.ParseForm(); err != nil {
		return sectionForm{}, err
	}
	return sectionForm{
		Name:           strings.TrimSpace(r.PostForm.Get("name")),
		Description:    strings.TrimSpace(r.PostForm.Get("description")),
		ModsOnlyTopics: r.PostForm.Get("mods_only_topics") != "",
	}, nil
}

func (s *sectionForm) check(lang string) {
	if !validator.NotBlank(s.Name) {
		s.AddError("name", i18n.T(lang, "server.errors.form.blank"))
	}
	s.Check(validator.MaxChars(s.Name, sectionNameMaxChars), "name",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": sectionNameMaxChars}))
	s.Check(validator.MaxChars(s.Description, sectionDescriptionMaxChars), "description",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": sectionDescriptionMaxChars}))
}

type sectionModData struct {
	view
	// Section is the one edited; its ID is 0 on the page of a new one.
	Section Section
	Form    sectionForm
}

// editSection is the page of a new section (no id in the address) or of an existing one, and the
// address its form posts to. A new section goes last; done, the browser goes back to the list.
func (f *Forum) editSection(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	var s Section
	if r.PathValue("id") != "" {
		id, ok := idParam(r)
		if !ok {
			f.host.NotFound(w, r)
			return
		}
		var err error
		s, err = f.loadSectionByID(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			f.host.NotFound(w, r)
			return
		}
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
	}
	data := sectionModData{view: v, Section: s, Form: sectionForm{Name: s.Name, Description: s.Description, ModsOnlyTopics: s.ModsOnlyTopics}}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readSectionForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if form.check(v.Lang); form.Valid() {
			entry, change := sectionChange(s.ID, form)
			if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change); err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, sectionsURL, http.StatusSeeOther)
			return
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	title := i18n.T(v.Lang, "forum.moderation.newSection")
	if s.ID != 0 {
		title = i18n.T(v.Lang, "forum.moderation.editSection")
	}
	f.render(w, r, status, "section_mod.html", data, Page{Title: title, NoIndex: true})
}

// sectionChange creates a section (id 0) at the end of the list or changes one; the log keeps
// what an edit replaced.
func sectionChange(id int, form sectionForm) (modEntry, modChange) {
	if id == 0 {
		return modEntry{Action: actionCreateSection}, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
			return tx.QueryRow(ctx, `
				INSERT INTO forum_sections (name, description, mods_only_topics, position)
				VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM forum_sections))
				RETURNING id`, form.Name, form.Description, form.ModsOnlyTopics).Scan(&e.SectionID)
		}
	}
	return modEntry{Action: actionEditSection, SectionID: id}, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		var old Section
		err := tx.QueryRow(ctx, `
			UPDATE forum_sections s SET name = $2, description = $3, mods_only_topics = $4
			FROM (SELECT id, name, description, mods_only_topics FROM forum_sections WHERE id = $1 FOR UPDATE) o
			WHERE s.id = o.id AND (o.name, o.description, o.mods_only_topics) IS DISTINCT FROM ($2, $3, $4)
			RETURNING o.name, o.description, o.mods_only_topics`, id, form.Name, form.Description, form.ModsOnlyTopics).
			Scan(&old.Name, &old.Description, &old.ModsOnlyTopics)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoChange
		}
		e.Data["name"], e.Data["description"], e.Data["modsOnlyTopics"] = old.Name, old.Description, old.ModsOnlyTopics
		return err
	}
}

// moveSection swaps the section with its neighbour above or below (the form's direction) and
// numbers all sections anew: positions may tie, and a swap of tied numbers would move nothing. The
// first section up or the last down stays. The browser goes back to the section in the list.
func (f *Forum) moveSection(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	if !f.modOnly(w, r, v) {
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	step := map[string]int{"up": -1, "down": 1}[r.PostForm.Get("direction")]
	if step == 0 {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	found := false
	err := f.moderate(r.Context(), v.Viewer, v.Now, modEntry{Action: actionMoveSection, SectionID: id},
		func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
			rows, err := tx.Query(ctx, `SELECT id FROM forum_sections ORDER BY position, id FOR UPDATE`)
			if err != nil {
				return err
			}
			ids, err := pgx.CollectRows(rows, pgx.RowTo[int])
			if err != nil {
				return err
			}
			from := slices.Index(ids, id)
			found = from >= 0
			to := from + step
			if !found || to < 0 || to >= len(ids) {
				return errNoChange
			}
			ids[from], ids[to] = ids[to], ids[from]
			// Places in the list, from 1, as the log page will word them.
			e.Data["from"], e.Data["to"] = from+1, to+1
			_, err = tx.Exec(ctx, `
				UPDATE forum_sections s SET position = o.n
				FROM unnest($1::int[]) WITH ORDINALITY o(id, n)
				WHERE s.id = o.id AND s.position <> o.n`, ids)
			return err
		})
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if !found {
		f.host.NotFound(w, r)
		return
	}
	http.Redirect(w, r, sectionsURL+"#section-"+strconv.Itoa(id), http.StatusSeeOther)
}

// loadSectionByID is a section as stored, without the counters of the home.
func (f *Forum) loadSectionByID(ctx context.Context, id int) (Section, error) {
	row, err := f.db.Query(ctx, `
		SELECT id, name, description, position, mods_only_topics FROM forum_sections WHERE id = $1`, id)
	if err != nil {
		return Section{}, err
	}
	return pgx.CollectExactlyOneRow(row, pgx.RowToStructByPos[Section])
}
