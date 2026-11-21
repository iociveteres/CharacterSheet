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
	Sections []modSectionRow
}

// modSectionRow is a row of the moderators' tree of sections. First and Last: the section begins or
// ends its siblings, so its button "up" or "down" moves nothing.
type modSectionRow struct {
	Section
	First, Last bool
}

// modSectionRows marks the ends of each run of siblings in a list in the order of the home.
func modSectionRows(sections []Section) []modSectionRow {
	rows := make([]modSectionRow, len(sections))
	last := map[int]int{}
	for i, s := range sections {
		_, seen := last[s.ParentID]
		rows[i] = modSectionRow{Section: s, First: !seen}
		last[s.ParentID] = i
	}
	for _, i := range last {
		rows[i].Last = true
	}
	return rows
}

// sectionsPage is the moderators' list of sections in the order of the home, subsections under
// their parent, with the buttons that move one up or down among its siblings and the links to edit
// one or add another. A section is never deleted.
func (f *Forum) sectionsPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	sections, err := f.sectionList(r.Context())
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.render(w, r, http.StatusOK, "sections_mod.html", sectionsModData{view: v, Sections: modSectionRows(sections)}, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.sections"),
		NoIndex: true,
	})
}

// sectionForm is what the form of a new or edited section sends.
type sectionForm struct {
	Name           string
	Description    string
	ModsOnlyTopics bool
	// Parent is the section it is inside, 0 at the top level; -1 for a value that is no section.
	Parent int
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
		Parent:         parentParam(r.PostForm.Get("parent")),
	}, nil
}

// parentParam is the field "parent": empty for the top level, else a section's id; -1 for what is
// neither.
func parentParam(value string) int {
	if value == "" {
		return 0
	}
	id, err := strconv.Atoi(value)
	if err != nil || id < 1 {
		return -1
	}
	return id
}

func (s *sectionForm) check(lang string) {
	if !validator.NotBlank(s.Name) {
		s.AddError("name", i18n.T(lang, "server.errors.form.blank"))
	}
	s.Check(validator.MaxChars(s.Name, sectionNameMaxChars), "name",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": sectionNameMaxChars}))
	s.Check(validator.MaxChars(s.Description, sectionDescriptionMaxChars), "description",
		i18n.T(lang, "forum.errors.tooLong", i18n.Params{"count": sectionDescriptionMaxChars}))
	s.Check(s.Parent >= 0, "parent", i18n.T(lang, "forum.moderation.noSection"))
}

// A subsection has no subsections (_prd/forum/subsections, 1): the parent must be at the top level
// and the section that goes inside it must have no subsections of its own.
var (
	errNesting  = errors.New("forum: sections nest one level deep")
	errNoParent = errors.New("forum: no such parent section")
)

type sectionModData struct {
	view
	// Section is the one edited; its ID is 0 on the page of a new one.
	Section Section
	Form    sectionForm
	// Parents are what the field «Inside section» offers: the top level but the section itself.
	Parents []Section
	// HasChildren: the section is a parent, which cannot go inside another; the field is off.
	HasChildren bool
}

// editSection is the page of a new section (no id in the address) or of an existing one, and the
// address its form posts to. A new section goes last among its siblings; done, the browser goes
// back to the list.
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
	sections, err := f.sectionList(r.Context())
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := sectionModData{view: v, Section: s,
		Form: sectionForm{Name: s.Name, Description: s.Description, ModsOnlyTopics: s.ModsOnlyTopics, Parent: s.ParentID}}
	for _, c := range sections {
		if c.ParentID == 0 && c.ID != s.ID {
			data.Parents = append(data.Parents, c)
		}
		data.HasChildren = data.HasChildren || s.ID != 0 && c.ParentID == s.ID
	}
	if s.ID == 0 {
		// «+ Subsection» of the list comes with its parent chosen.
		data.Form.Parent = max(parentParam(r.URL.Query().Get("parent")), 0)
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readSectionForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if form.check(v.Lang); form.Valid() {
			entry, change := sectionChange(s.ID, form)
			err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change)
			switch {
			case errors.Is(err, errNesting):
				form.AddError("parent", i18n.T(v.Lang, "forum.moderation.nestOnce"))
			case errors.Is(err, errNoParent):
				form.AddError("parent", i18n.T(v.Lang, "forum.moderation.noSection"))
			case err != nil:
				f.host.ServerError(w, r, err)
				return
			default:
				http.Redirect(w, r, sectionsURL, http.StatusSeeOther)
				return
			}
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	title := i18n.T(v.Lang, "forum.moderation.newSection")
	if s.ID != 0 {
		title = i18n.T(v.Lang, "forum.moderation.editSection")
	}
	f.render(w, r, status, "section_mod.html", data, Page{Title: title, NoIndex: true})
}

// sectionChange creates a section (id 0) at the end of its siblings or changes one; the log keeps
// what an edit replaced. A section whose parent changes goes last among its new siblings, with its
// topics.
func sectionChange(id int, form sectionForm) (modEntry, modChange) {
	if id == 0 {
		return modEntry{Action: actionCreateSection}, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
			if err := lockFamily(ctx, tx, 0, form.Parent); err != nil {
				return err
			}
			return tx.QueryRow(ctx, `
				INSERT INTO forum_sections (name, description, mods_only_topics, parent_id, position)
				VALUES ($1, $2, $3, NULLIF($4, 0), (SELECT COALESCE(max(position), 0) + 1 FROM forum_sections
				                                    WHERE parent_id IS NOT DISTINCT FROM NULLIF($4, 0)))
				RETURNING id`, form.Name, form.Description, form.ModsOnlyTopics, form.Parent).Scan(&e.SectionID)
		}
	}
	return modEntry{Action: actionEditSection, SectionID: id}, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		if err := lockFamily(ctx, tx, id, form.Parent); err != nil {
			return err
		}
		var old Section
		err := tx.QueryRow(ctx, `
			UPDATE forum_sections s SET name = $2, description = $3, mods_only_topics = $4, parent_id = NULLIF($5, 0),
			    position = CASE WHEN o.parent = $5 THEN s.position
			                    ELSE (SELECT COALESCE(max(position), 0) + 1 FROM forum_sections
			                          WHERE parent_id IS NOT DISTINCT FROM NULLIF($5, 0)) END
			FROM (SELECT id, name, description, mods_only_topics, COALESCE(parent_id, 0) AS parent
			      FROM forum_sections WHERE id = $1) o
			WHERE s.id = o.id AND (o.name, o.description, o.mods_only_topics, o.parent) IS DISTINCT FROM ($2, $3, $4, $5)
			RETURNING o.name, o.description, o.mods_only_topics, o.parent`,
			id, form.Name, form.Description, form.ModsOnlyTopics, form.Parent).
			Scan(&old.Name, &old.Description, &old.ModsOnlyTopics, &old.ParentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoChange
		}
		e.Data["name"], e.Data["description"], e.Data["modsOnlyTopics"] = old.Name, old.Description, old.ModsOnlyTopics
		if old.ParentID != form.Parent {
			// Where it was and where it went, 0 for the top level; the log names them as they are now.
			e.Data["parent"], e.Data["parentTo"] = old.ParentID, form.Parent
		}
		return err
	}
}

// lockFamily locks the section id (0 for a new one) and the parent it goes inside (0 for the top
// level), in the order of their ids, and keeps sections one level deep: the parent exists and is at
// the top level, and a section with subsections goes nowhere inside. Creating a subsection locks
// its parent and moving a section locks the section, so of two that would make a second level
// between them one waits for the other and then sees it.
func lockFamily(ctx context.Context, tx pgx.Tx, id, parent int) error {
	if parent == 0 {
		return nil
	}
	if parent == id {
		return errNesting
	}
	rows, err := tx.Query(ctx, `
		SELECT id, COALESCE(parent_id, 0) FROM forum_sections WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
		[]int{id, parent})
	if err != nil {
		return err
	}
	parents := map[int]int{}
	var rowID, rowParent int
	_, err = pgx.ForEachRow(rows, []any{&rowID, &rowParent}, func() error {
		parents[rowID] = rowParent
		return nil
	})
	if err != nil {
		return err
	}
	grand, ok := parents[parent]
	if !ok {
		return errNoParent
	}
	if grand != 0 {
		return errNesting
	}
	if id == 0 {
		return nil
	}
	var hasChildren bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM forum_sections WHERE parent_id = $1)`, id).Scan(&hasChildren); err != nil {
		return err
	}
	if hasChildren {
		return errNesting
	}
	return nil
}

// moveSection swaps the section with its sibling above or below (the form's direction) and numbers
// its siblings anew: positions may tie, and a swap of tied numbers would move nothing. A subsection
// stays inside its parent; the first up or the last down stays. The browser goes back to the
// section in the list.
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
			rows, err := tx.Query(ctx, `
				SELECT id FROM forum_sections
				WHERE parent_id IS NOT DISTINCT FROM (SELECT parent_id FROM forum_sections WHERE id = $1)
				ORDER BY position, id FOR UPDATE`, id)
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
			// Places among the siblings, from 1, as the log page will word them.
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

// loadSectionByID is a section as stored, with its parent's name, without the counters of the home.
func (f *Forum) loadSectionByID(ctx context.Context, id int) (Section, error) {
	row, err := f.db.Query(ctx, `
		SELECT `+sectionColumns+` FROM forum_sections s
		LEFT JOIN forum_sections ps ON ps.id = s.parent_id
		WHERE s.id = $1`, id)
	if err != nil {
		return Section{}, err
	}
	return pgx.CollectExactlyOneRow(row, pgx.RowToStructByPos[Section])
}
