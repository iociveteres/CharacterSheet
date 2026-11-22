package forum

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5"
)

// The user page (block 6 of extras/plan.md, users.md): the head, «О себе», the moderators' block
// and the tabs of the user's posts and topics. Every name the forum writes links here.

const (
	userPostsPerPage  = 20
	userTopicsPerPage = 30
	// aboutMaxLength is the length of «О себе» in characters (users.md); the table checks it too.
	aboutMaxLength = 500
	// userHistoryLength is how many lines of the log the moderators' block shows.
	userHistoryLength = 5
)

func userURL(id int) string {
	return "/forum/user/" + strconv.Itoa(id)
}

// shownName is a name as the reader sees it. A deleted account keeps its id with an empty name
// (_prd/account_deletion/plan.md, 3), which the reader's language words; a sign-up never leaves a
// name empty.
func shownName(lang, name string) string {
	if name == "" {
		return i18n.T(lang, "common.deletedUser")
	}
	return name
}

// shownTitle is a topic's title as the reader sees it: a topic its author erased whole with their
// account keeps an empty one, which moderators and notifications still show.
func shownTitle(lang, title string) string {
	if title == "" {
		return i18n.T(lang, "forum.topics.erasedTitle")
	}
	return title
}

// forumUser is a user as their page shows them.
type forumUser struct {
	ID           int
	Name         string
	RegisteredAt time.Time
	Moderator    bool
	// Posts and Topics count what a guest finds, as the author column of a post does.
	Posts, Topics int
	// ListedPosts and ListedTopics are what the viewer's tabs list: a moderator's count the deleted.
	ListedPosts, ListedTopics int
	// LastPostID and LastPostAt are the last post a guest finds, nil without one.
	LastPostID *int
	LastPostAt *time.Time
	About      string
	// Ban is the standing ban, nil without one; a moderator is never banned (Banned).
	Ban *userBan
	// Erased is the moderator's erasing of «О себе» while the user has not written it again.
	Erased *userAct
}

// userAct is who did something to the user, when and why.
type userAct struct {
	At            time.Time
	Reason        string
	ModeratorID   int
	ModeratorName string
}

type userBan struct {
	userAct
	ExpiresAt *time.Time
}

// Banned: the ban binds, as Viewer.Banned.
func (u forumUser) Banned() bool {
	return u.Ban != nil && !u.Moderator
}

func (u forumUser) URL() string {
	return userURL(u.ID)
}

func (u forumUser) AboutLength() int {
	return utf8.RuneCountInString(u.About)
}

// loadUser reads the user with their counters, «О себе», standing ban and erasing in one query;
// pgx.ErrNoRows for no such user. The tabs' counters are the viewer's (CanReadTopic,
// CanReadDeletedPosts): a moderator's count the deleted too.
func (f *Forum) loadUser(ctx context.Context, id int, v Viewer, now time.Time) (forumUser, error) {
	u := forumUser{ID: id}
	var lastID *int
	var lastAt *time.Time
	var banReason, banBy, eraseReason, eraseBy *string
	var banAt, banExpires, eraseAt *time.Time
	var banByID, eraseByID *int
	err := f.db.QueryRow(ctx, `
		SELECT u.name, u.created_at, EXISTS (SELECT 1 FROM forum_moderators m WHERE m.user_id = u.id),
		       (SELECT count(*) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
		        WHERE p.author_id = u.id AND p.deleted_at IS NULL AND t.deleted_at IS NULL),
		       (SELECT count(*) FROM forum_topics t WHERE t.author_id = u.id AND t.deleted_at IS NULL),
		       (SELECT count(*) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
		        WHERE p.author_id = u.id AND ($3 OR p.deleted_at IS NULL AND t.deleted_at IS NULL)),
		       (SELECT count(*) FROM forum_topics t WHERE t.author_id = u.id AND ($3 OR t.deleted_at IS NULL)),
		       lp.id, lp.created_at, COALESCE(pr.about, ''),
		       b.created_at, b.reason, b.expires_at, b.moderator_id, bm.name,
		       e.created_at, e.reason, e.moderator_id, em.name
		FROM users u
		LEFT JOIN forum_profiles pr ON pr.user_id = u.id
		LEFT JOIN LATERAL (
			SELECT p.id, p.created_at FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
			WHERE p.author_id = u.id AND p.deleted_at IS NULL AND t.deleted_at IS NULL
			ORDER BY p.created_at DESC, p.id DESC LIMIT 1
		) lp ON true
		LEFT JOIN LATERAL (
			SELECT created_at, reason, expires_at, moderator_id FROM forum_bans
			WHERE user_id = u.id AND `+standingBanSQL("$2")+`
			ORDER BY expires_at DESC NULLS FIRST, id DESC LIMIT 1
		) b ON true
		LEFT JOIN users bm ON bm.id = b.moderator_id
		LEFT JOIN LATERAL (
			-- The erasing stands until the user writes again: the profile row is newer then.
			SELECT l.created_at, l.reason, l.moderator_id FROM forum_mod_log l
			WHERE l.user_id = u.id AND l.action = $4 AND COALESCE(pr.about, '') = ''
			  AND (pr.updated_at IS NULL OR l.created_at >= pr.updated_at)
			ORDER BY l.id DESC LIMIT 1
		) e ON true
		LEFT JOIN users em ON em.id = e.moderator_id
		-- A deleted account has no page (_prd/account_deletion/plan.md, 3).
		WHERE u.id = $1 AND u.status <> 'deleted'`, id, now, v.CanReadDeletedPosts(), string(actionEraseAbout)).
		Scan(&u.Name, &u.RegisteredAt, &u.Moderator, &u.Posts, &u.Topics, &u.ListedPosts, &u.ListedTopics,
			&lastID, &lastAt, &u.About,
			&banAt, &banReason, &banExpires, &banByID, &banBy,
			&eraseAt, &eraseReason, &eraseByID, &eraseBy)
	if err != nil {
		return u, err
	}
	u.LastPostID, u.LastPostAt = lastID, lastAt
	if banAt != nil {
		u.Ban = &userBan{userAct: userAct{At: *banAt, Reason: *banReason, ModeratorID: *banByID, ModeratorName: *banBy}, ExpiresAt: banExpires}
	}
	if eraseAt != nil {
		u.Erased = &userAct{At: *eraseAt, Reason: *eraseReason, ModeratorID: *eraseByID, ModeratorName: *eraseBy}
	}
	return u, nil
}

// userPost is a line of the tab «Posts»: the topic, the beginning of the text, where and when.
type userPost struct {
	ID          int
	TopicTitle  string
	SectionName string
	At          time.Time
	Excerpt     string
	// Deleted: the post or its topic is, for a moderator only.
	Deleted bool
}

func (p userPost) URL() string {
	return postURL(p.ID)
}

// userPosts reads one page of the user's posts, the newest first, by forum_posts_author_created_idx.
func (f *Forum) userPosts(ctx context.Context, userID, page int, v Viewer) ([]userPost, error) {
	rows, err := f.db.Query(ctx, `
		SELECT p.id, t.title, s.name, p.created_at, left(p.body, 2000),
		       p.deleted_at IS NOT NULL OR t.deleted_at IS NOT NULL
		FROM forum_posts p
		JOIN forum_topics t ON t.id = p.topic_id
		JOIN forum_sections s ON s.id = t.section_id
		WHERE p.author_id = $1 AND ($2 OR p.deleted_at IS NULL AND t.deleted_at IS NULL)
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT $3 OFFSET $4`, userID, v.CanReadDeletedPosts(), userPostsPerPage, (page-1)*userPostsPerPage)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (userPost, error) {
		var p userPost
		var body string
		err := row.Scan(&p.ID, &p.TopicTitle, &p.SectionName, &p.At, &body, &p.Deleted)
		p.Excerpt = excerpt(body)
		return p, err
	})
}

// lockTerms are the terms of the lock on a new avatar the form offers (extras/decisions.md, 16):
// none, 7 and 30 days, for good. The form sends the string.
var lockTerms = []string{"none", "7", "30", "forever"}

// lockChoice is a term of lockTerms as the form shows it: Days for a term in days, 0 otherwise.
type lockChoice struct {
	Value string
	Days  int
}

func lockChoices() []lockChoice {
	choices := make([]lockChoice, len(lockTerms))
	for i, term := range lockTerms {
		days, _ := strconv.Atoi(term)
		choices[i] = lockChoice{Value: term, Days: days}
	}
	return choices
}

// userForms is what the moderators' forms and the form of «О себе» hold after an error: the form
// the page opens and what was typed in it.
type userForms struct {
	// Open names the form whose <details> is open: ban, avatar, erase, about.
	Open   string
	Ban    modForm
	Avatar modForm
	Erase  modForm
	About  aboutForm
}

type aboutForm struct {
	About string
	validator.Validator
}

// userMod is the moderators' block of another's page.
type userMod struct {
	Avatar AvatarState
	// LockedBy is the name of the moderator of the avatar's lock.
	LockedBy string
	History  []logLine
	BanDays  []int
	Locks    []lockChoice
}

type userData struct {
	view
	User   forumUser
	Avatar avatar
	// Own: the viewer's own page.
	Own        bool
	AccountURL string
	// Tab is posts or topics.
	Tab        string
	Posts      []userPost
	Topics     []topicRow
	Pagination pagination
	Mod        *userMod
	Forms      userForms
	// FormerNames are the user's last names before the current one, the latest first.
	FormerNames []formerName
}

// formerName is a name the user had until ChangedAt (_prd/account_name_email/plan.md, §3).
type formerName struct {
	Name      string
	ChangedAt time.Time
}

// formerNamesShown is how many former names the page shows, as the Account page; the history keeps
// them all.
const formerNamesShown = 10

func (f *Forum) formerNames(ctx context.Context, userID int) ([]formerName, error) {
	rows, err := f.db.Query(ctx, `
		SELECT name, changed_at FROM user_name_history
		WHERE user_id = $1 ORDER BY changed_at DESC, id DESC LIMIT $2`, userID, formerNamesShown)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[formerName])
}

// TopicLine is a row of the tab «Topics»: {{template "forum-topic-row" ($.TopicLine .)}}.
func (d userData) TopicLine(t topicRow) topicLine {
	return topicLine{view: d.view, Row: t, BySection: true}
}

// AboutCount is the counter under the field: what the form holds, else the stored text.
func (d userData) AboutCount() int {
	if d.Forms.Open == "about" {
		return utf8.RuneCountInString(d.Forms.About.About)
	}
	return d.User.AboutLength()
}

// AboutText is what the field of «О себе» holds.
func (d userData) AboutText() string {
	if d.Forms.Open == "about" {
		return d.Forms.About.About
	}
	return d.User.About
}

func (d userData) AboutMax() int {
	return aboutMaxLength
}

// userPage is GET /forum/user/{id}?tab=posts|topics&page=N; anyone who reads the forum sees it.
func (f *Forum) userPage(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	f.renderUser(w, r, v, id, http.StatusOK, userForms{})
}

// renderUser draws the user page with forms as they are, the open one after an error with status
// 422.
func (f *Forum) renderUser(w http.ResponseWriter, r *http.Request, v view, id, status int, forms userForms) {
	// A moderator's form brought back with its error shows as in the moderator mode, whatever the
	// mode: the action came by its address (_prd/forum/moderator-mode/plan.md, mechanism 4).
	if forms.Open != "" && forms.Open != "about" {
		v.Shown = v.Viewer
	}
	page, pageOK := pageParam(r)
	tab := r.URL.Query().Get("tab")
	if tab == "" {
		tab = "posts"
	}
	if !pageOK || tab != "posts" && tab != "topics" || r.URL.Query().Has("tab") && tab == "posts" {
		// ?tab=posts is the address without it: one address per page.
		f.host.NotFound(w, r)
		return
	}
	ctx := r.Context()
	u, err := f.loadUser(ctx, id, v.Shown, v.Now)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := userData{view: v, User: u, Own: v.Viewer.ID == u.ID, AccountURL: f.host.AccountURL(), Tab: tab, Forms: forms}
	path, total, perPage := u.URL(), u.ListedPosts, userPostsPerPage
	if tab == "topics" {
		path, total, perPage = u.URL()+"?tab=topics", u.ListedTopics, userTopicsPerPage
	}
	pages := pageCount(total, perPage)
	if page > pages {
		f.host.NotFound(w, r)
		return
	}
	data.Pagination = pagination{Lang: v.Lang, Path: path, Current: page, Total: pages}
	if tab == "posts" {
		data.Posts, err = f.userPosts(ctx, u.ID, page, v.Shown)
	} else {
		data.Topics, err = f.topicRows(ctx, "t.author_id = $1", "t.created_at DESC, t.id DESC", u.ID, page, userTopicsPerPage, v.Shown)
	}
	if err == nil {
		data.FormerNames, err = f.formerNames(ctx, u.ID)
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	avatarURL := ""
	if v.Shown.CanModerateUser(u) {
		mod, err := f.userMod(r, u)
		if err != nil {
			f.host.ServerError(w, r, err)
			return
		}
		data.Mod, avatarURL = mod, mod.Avatar.URL
	} else {
		avatarURL = f.avatars(r, u.ID)[u.ID]
	}
	data.Avatar = newAvatar(avatarURL, u.Name, u.ID, avatarSize)

	title := u.Name
	if tab == "topics" {
		title += " — " + i18n.T(v.Lang, "forum.users.topics")
	}
	description := plainText(u.About, descriptionLength)
	if description == "" {
		description = i18n.T(v.Lang, "forum.users.description", i18n.Params{"name": u.Name})
	}
	// Out of search engines: a page of a user is a page of links they chose, the oldest way to sell
	// a link on a forum; their posts are indexed in their topics.
	f.render(w, r, status, "user.html", data, Page{
		Title:       pageTitle(v.Lang, title, page),
		Description: description,
		Canonical:   f.baseURL + pageURL(path, page),
		NoIndex:     true,
	})
}

// userMod gathers the moderators' block: the avatar and its lock from the host, the user's last
// lines of the log. The avatar is worth less than the page, as on every page: an error of the host
// is logged and the block shows no avatar.
func (f *Forum) userMod(r *http.Request, u forumUser) (*userMod, error) {
	m := &userMod{BanDays: banDays, Locks: lockChoices()}
	state, err := f.host.AvatarState(r.Context(), u.ID)
	if err != nil {
		f.host.LogError(r, err)
	}
	m.Avatar = state
	if state.Lock != nil {
		err := f.db.QueryRow(r.Context(), `SELECT name FROM users WHERE id = $1`, state.Lock.ModeratorID).Scan(&m.LockedBy)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	m.History, err = f.logLines(r.Context(), u.ID, userHistoryLength, 0)
	return m, err
}

// userToActOn reads the user of the address of a form for a viewer who may act (allowed): a guest
// is sent to sign in, no such user is not found, a viewer without the right gets 403.
func (f *Forum) userToActOn(w http.ResponseWriter, r *http.Request, v view, allowed func(Viewer, forumUser) bool) (forumUser, bool) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return forumUser{}, false
	}
	if !v.Viewer.SignedIn() {
		forbidden(w)
		return forumUser{}, false
	}
	u, err := f.loadUser(r.Context(), id, v.Viewer, v.Now)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return u, false
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return u, false
	}
	if !allowed(v.Viewer, u) {
		forbidden(w)
		return u, false
	}
	return u, true
}

// actDone ends a form of the page: a flash, then back to the page, or to the list of bans when
// the form came from it.
func (f *Forum) actDone(w http.ResponseWriter, r *http.Request, u forumUser, flash string) {
	f.host.PutFlash(r, flash)
	to := u.URL()
	if r.PostFormValue("back") == "bans" {
		to = bansURL
	}
	http.Redirect(w, r, to, http.StatusSeeOther)
}

// saveAbout is POST /forum/user/{id}/about: the user's own «О себе», on their own page only.
func (f *Forum) saveAbout(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanEditAbout)
	if !ok {
		return
	}
	// A browser sends the line breaks of a field as CRLF; the length counts one character each, as
	// the field's maxlength does.
	about := strings.TrimSpace(strings.ReplaceAll(r.PostFormValue("about"), "\r\n", "\n"))
	form := aboutForm{About: about}
	if n := utf8.RuneCountInString(about); n > aboutMaxLength {
		form.AddError("about", i18n.T(v.Lang, "forum.errors.tooLong", i18n.Params{"count": aboutMaxLength}))
		f.renderUser(w, r, v, u.ID, http.StatusUnprocessableEntity, userForms{Open: "about", About: form})
		return
	}
	_, err := f.db.Exec(r.Context(), `
		INSERT INTO forum_profiles (user_id, about, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET about = EXCLUDED.about, updated_at = EXCLUDED.updated_at`,
		u.ID, about, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.aboutSaved"))
}

// requireReason reads the reason every action of the moderators' block needs: its user reads it.
func requireReason(r *http.Request, lang string) modForm {
	form := modForm{Reason: strings.TrimSpace(r.PostFormValue("reason")), Duration: r.PostFormValue("duration")}
	if !validator.NotBlank(form.Reason) {
		form.AddError("reason", i18n.T(lang, "server.errors.form.blank"))
	}
	form.checkReason(lang)
	return form
}

// eraseAbout is POST /forum/user/{id}/about/erase: the text goes, not kept, the log keeps the
// reason, and the user is told.
func (f *Forum) eraseAbout(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanActOnUser)
	if !ok {
		return
	}
	form := requireReason(r, v.Lang)
	if !form.Valid() {
		f.renderUser(w, r, v, u.ID, http.StatusUnprocessableEntity, userForms{Open: "erase", Erase: form})
		return
	}
	entry := modEntry{Action: actionEraseAbout, UserID: u.ID, Reason: form.Reason}
	err := f.moderate(r.Context(), v.Viewer, v.Now, entry, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		tag, err := tx.Exec(ctx, `
			UPDATE forum_profiles SET about = '', updated_at = $2 WHERE user_id = $1 AND about <> ''`, u.ID, v.Now)
		return changed(tag.RowsAffected(), err)
	})
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.aboutErased"))
}

// banFromPage is POST /forum/user/{id}/ban: the ban of the moderators' block, as the ban from a
// post but for no post.
func (f *Forum) banFromPage(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanActOnUser)
	if !ok {
		return
	}
	form := requireReason(r, v.Lang)
	days, termOK := parseBanDays(form.Duration)
	if !termOK {
		form.AddError("duration", i18n.T(v.Lang, "forum.moderation.noBanTerm"))
	}
	if !form.Valid() {
		f.renderUser(w, r, v, u.ID, http.StatusUnprocessableEntity, userForms{Open: "ban", Ban: form})
		return
	}
	entry, change := banUserChange(u.ID, 0, 0, days, form.Reason, v.Viewer.ID, v.Now)
	if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.banned"))
}

// liftUserBan is POST /forum/user/{id}/lift-ban: every standing ban of the user goes.
func (f *Forum) liftUserBan(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanActOnUser)
	if !ok {
		return
	}
	entry := modEntry{Action: actionUnbanUser, UserID: u.ID}
	err := f.moderate(r.Context(), v.Viewer, v.Now, entry, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		rows, err := tx.Query(ctx, `
			UPDATE forum_bans SET lifted_at = $2, lifted_by = $3
			WHERE user_id = $1 AND `+standingBanSQL("$2")+`
			RETURNING id`, u.ID, v.Now, v.Viewer.ID)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return errNoChange
		}
		slices.Sort(ids)
		e.Data["banId"] = ids[len(ids)-1]
		return nil
	})
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.banLifted"))
}

// lockUntil is the end of the lock a term of lockTerms gives from at: nil Until for good, a nil
// lock for none.
func lockUntil(term string, at time.Time) (*AvatarLock, bool) {
	switch term {
	case "none":
		return nil, true
	case "forever":
		return &AvatarLock{}, true
	}
	days, err := strconv.Atoi(term)
	if err != nil || !slices.Contains(lockTerms, term) {
		return nil, false
	}
	end := at.AddDate(0, 0, days)
	return &AvatarLock{Until: &end}, true
}

// removeAvatar is POST /forum/user/{id}/avatar: the site removes the avatar (and locks a new one),
// then the forum writes its log and notification in a transaction of its own (avatars.md,
// «Граница с форумом»). Should the second fail, the avatar is gone without a line: the moderator
// sees the error and repeats, which is safe.
func (f *Forum) removeAvatar(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanActOnUser)
	if !ok {
		return
	}
	form := requireReason(r, v.Lang)
	form.Duration = r.PostFormValue("lock")
	lock, termOK := lockUntil(form.Duration, v.Now)
	if !termOK {
		form.AddError("lock", i18n.T(v.Lang, "forum.moderation.noBanTerm"))
	}
	if !form.Valid() {
		f.renderUser(w, r, v, u.ID, http.StatusUnprocessableEntity, userForms{Open: "avatar", Avatar: form})
		return
	}
	state, err := f.host.AvatarState(r.Context(), u.ID)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if state.URL == "" {
		// Removed already (a form sent twice): nothing to tell anyone.
		http.Redirect(w, r, u.URL(), http.StatusSeeOther)
		return
	}
	data := map[string]any{"lock": form.Duration, "lockUntil": nil}
	if lock != nil {
		lock.Reason, lock.ModeratorID, lock.UserID = form.Reason, v.Viewer.ID, u.ID
		data["lockUntil"] = lock.Until
	}
	if err := f.host.RemoveAvatar(r.Context(), u.ID, lock); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	entry := modEntry{Action: actionRemoveAvatar, UserID: u.ID, Reason: form.Reason, Data: data}
	if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, siteChange); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.avatarRemoved"))
}

// liftAvatarLock is POST /forum/user/{id}/lift-avatar-lock, from the user page and from the list of
// bans (back=bans): the site lifts the lock first, then the forum's log and notification.
func (f *Forum) liftAvatarLock(w http.ResponseWriter, r *http.Request, v view) {
	u, ok := f.userToActOn(w, r, v, Viewer.CanModerateUser)
	if !ok {
		return
	}
	state, err := f.host.AvatarState(r.Context(), u.ID)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	if state.Lock == nil {
		f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.avatarUnlocked"))
		return
	}
	if err := f.host.LiftAvatarLock(r.Context(), u.ID); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	entry := modEntry{Action: actionUnlockAvatar, UserID: u.ID, Data: map[string]any{"lockUntil": state.Lock.Until}}
	if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, siteChange); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.actDone(w, r, u, i18n.T(v.Lang, "forum.users.avatarUnlocked"))
}

// siteChange is the change of an action the site has made already through the host: moderate only
// writes its log and notification.
func siteChange(context.Context, pgx.Tx, *modEntry) error {
	return nil
}
