package forum

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5"
)

const bansURL = "/forum/mod/bans"

// banDays are the terms of a ban its form offers, in days; 0 is until lifted (decision 10 of the
// plan). The form sends the number.
var banDays = []int{1, 7, 30, 0}

func parseBanDays(s string) (int, bool) {
	n, err := strconv.Atoi(s)
	return n, err == nil && slices.Contains(banDays, n)
}

// standingBanSQL is the condition of a ban of forum_bans that binds at the time of the parameter
// now: not lifted and not yet over. An expired ban stops binding by itself, nothing writes it.
func standingBanSQL(now string) string {
	return `lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ` + now + `)`
}

// checkBan: a ban needs a reason, its user reads it, and one of the terms of banDays.
func (m *modForm) checkBan(lang string) {
	if !validator.NotBlank(m.Reason) {
		m.AddError("reason", i18n.T(lang, "server.errors.form.blank"))
	}
	m.checkReason(lang)
	if _, ok := parseBanDays(m.Duration); !ok {
		m.AddError("duration", i18n.T(lang, "forum.moderation.noBanTerm"))
	}
}

type banData struct {
	view
	Post postTarget
	// Card is the post the ban is given for, as the moderator sees it in the topic.
	Card postCard
	// Standing is the user's ban that the new one replaces, nil without one.
	Standing *Ban
	Days     []int
	Form     modForm
}

// banUser is the page of the ban given to the author of a post and the address its form posts to.
// A moderator is never banned (CanBan). Done, the browser goes back to the post.
func (f *Forum) banUser(w http.ResponseWriter, r *http.Request, v view) {
	p, ok := f.postToActOn(w, r, v, func(v Viewer, _ Topic, p post) bool { return v.CanBan(p) })
	if !ok {
		return
	}
	standing, err := f.standingBan(r.Context(), p.AuthorID, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	data := banData{
		view:     v,
		Post:     p,
		Card:     f.lonePostCard(r, v, p),
		Standing: standing,
		Days:     banDays,
		Form:     modForm{Duration: strconv.Itoa(banDays[0])},
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		form, err := readModForm(r)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if form.checkBan(v.Lang); form.Valid() {
			days, _ := parseBanDays(form.Duration)
			entry, change := banChange(p, days, form.Reason, v.Viewer.ID, v.Now)
			if err := f.moderate(r.Context(), v.Viewer, v.Now, entry, change); err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			http.Redirect(w, r, p.URL(), http.StatusSeeOther)
			return
		}
		data.Form, status = form, http.StatusUnprocessableEntity
	}
	f.render(w, r, status, "ban.html", data, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.banTitle", i18n.Params{"name": p.AuthorName}),
		NoIndex: true,
	})
}

// banChange gives the author of the post a ban of days (0: until lifted) from at. A standing ban
// gives way to the new one, so a moderator shortens or lengthens a ban by giving another; the log
// keeps the ids it replaced.
func banChange(p postTarget, days int, reason string, by int, at time.Time) (modEntry, modChange) {
	e := modEntry{Action: actionBanUser, UserID: p.AuthorID, PostID: p.ID, TopicID: p.Topic.ID, Reason: reason}
	var expires *time.Time
	if days > 0 {
		end := at.AddDate(0, 0, days)
		expires = &end
	}
	return e, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		rows, err := tx.Query(ctx, `
			UPDATE forum_bans SET lifted_at = $2, lifted_by = $3
			WHERE user_id = $1 AND `+standingBanSQL("$2")+`
			RETURNING id`, p.AuthorID, at, by)
		if err != nil {
			return err
		}
		replaced, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return err
		}
		var id int
		err = tx.QueryRow(ctx, `
			INSERT INTO forum_bans (user_id, moderator_id, reason, created_at, expires_at)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id`, p.AuthorID, by, reason, at, expires).Scan(&id)
		if err != nil {
			return err
		}
		e.Data["banId"], e.Data["expiresAt"] = id, expires
		if len(replaced) > 0 {
			e.Data["replaced"] = replaced
		}
		return nil
	}
}

// standingBan is the ban of the user that binds at now, nil without one; of overlapping bans the
// one that ends last, as the viewer gets it.
func (f *Forum) standingBan(ctx context.Context, userID int, now time.Time) (*Ban, error) {
	var b Ban
	err := f.db.QueryRow(ctx, `
		SELECT id, reason, created_at, expires_at FROM forum_bans
		WHERE user_id = $1 AND `+standingBanSQL("$2")+`
		ORDER BY expires_at DESC NULLS FIRST, id DESC
		LIMIT 1`, userID, now).Scan(&b.ID, &b.Reason, &b.CreatedAt, &b.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// banRow is a standing ban in the moderators' list.
type banRow struct {
	ID            int
	UserName      string
	ModeratorName string
	Reason        string
	CreatedAt     time.Time
	ExpiresAt     *time.Time
	// PostID is the post the ban was given for, from its line in the log.
	PostID *int
}

type bansData struct {
	view
	Bans []banRow
}

// bansPage lists the bans that bind now, the newest first, each with its button to lift it.
func (f *Forum) bansPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	rows, err := f.db.Query(r.Context(), `
		SELECT b.id, u.name, m.name, b.reason, b.created_at, b.expires_at, l.post_id
		FROM forum_bans b
		JOIN users u ON u.id = b.user_id
		JOIN users m ON m.id = b.moderator_id
		LEFT JOIN forum_mod_log l ON l.action = '`+string(actionBanUser)+`' AND l.data->>'banId' = b.id::text
		WHERE `+standingBanSQL("$1")+`
		ORDER BY b.created_at DESC, b.id DESC`, v.Now)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	bans, err := pgx.CollectRows(rows, pgx.RowToStructByPos[banRow])
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.render(w, r, http.StatusOK, "bans_mod.html", bansData{view: v, Bans: bans}, Page{
		Title:   i18n.T(v.Lang, "forum.moderation.bans"),
		NoIndex: true,
	})
}

// liftBan is the button "Lift" of the list of bans. A ban that no longer binds (lifted, expired)
// stays as it is; the browser goes back to the list either way.
func (f *Forum) liftBan(w http.ResponseWriter, r *http.Request, v view) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	if !f.modOnly(w, r, v) {
		return
	}
	entry := modEntry{Action: actionUnbanUser, Data: map[string]any{"banId": id}}
	err := f.moderate(r.Context(), v.Viewer, v.Now, entry, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		err := tx.QueryRow(ctx, `
			UPDATE forum_bans SET lifted_at = $2, lifted_by = $3
			WHERE id = $1 AND `+standingBanSQL("$2")+`
			RETURNING user_id`, id, v.Now, v.Viewer.ID).Scan(&e.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoChange
		}
		return err
	})
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	http.Redirect(w, r, bansURL, http.StatusSeeOther)
}
