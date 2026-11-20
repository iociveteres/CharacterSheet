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
	if _, ok := parseBanDays(m.Duration); !ok {
		m.AddError("duration", i18n.T(lang, "forum.moderation.noBanTerm"))
	}
}

// oldBanPage is the address of the page that banned the author of a post before the ban went into
// the post's delete window: it leads there, and that page asks for the rights. A deleted post has
// no delete window: its author's page, where the ban is (the author's answer 2 of results/7.md).
// A post of a deleted topic still goes to the window, which hides it from all but moderators.
func (f *Forum) oldBanPage(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r)
	if !ok {
		f.host.NotFound(w, r)
		return
	}
	var authorID int
	var deleted bool
	err := f.db.QueryRow(r.Context(), `
		SELECT p.author_id, p.deleted_at IS NOT NULL AND t.deleted_at IS NULL
		FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
		WHERE p.id = $1`, id).Scan(&authorID, &deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		f.host.NotFound(w, r)
		return
	}
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	target := postURL(id) + "/delete"
	if deleted {
		target = userURL(authorID)
	}
	http.Redirect(w, r, target, http.StatusMovedPermanently)
}

// banChange bans the author of the post from the delete window (block 7 of extras/plan.md) for days
// (0: until lifted) from at. Unlike the ban from their page, a standing ban stays as it is: the
// window offers no ban then, and a form sent twice or after another moderator's ban gives no second.
func banChange(p postTarget, days int, reason string, by int, at time.Time) (modEntry, modChange) {
	e, change := banUserChange(p.AuthorID, p.ID, p.Topic.ID, days, reason, by, at)
	return e, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		var banned bool
		err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM forum_bans WHERE user_id = $1 AND `+standingBanSQL("$2")+`)`,
			p.AuthorID, at).Scan(&banned)
		if err != nil {
			return err
		}
		if banned {
			return errNoChange
		}
		return change(ctx, tx, e)
	}
}

// banUserChange bans the user, from a post (postID and topicID) or from their page (0). A standing
// ban gives way to the new one; the log keeps the ids it replaced.
func banUserChange(userID, postID, topicID, days int, reason string, by int, at time.Time) (modEntry, modChange) {
	e := modEntry{Action: actionBanUser, UserID: userID, PostID: postID, TopicID: topicID, Reason: reason}
	var expires *time.Time
	if days > 0 {
		end := at.AddDate(0, 0, days)
		expires = &end
	}
	return e, func(ctx context.Context, tx pgx.Tx, e *modEntry) error {
		rows, err := tx.Query(ctx, `
			UPDATE forum_bans SET lifted_at = $2, lifted_by = $3
			WHERE user_id = $1 AND `+standingBanSQL("$2")+`
			RETURNING id`, userID, at, by)
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
			RETURNING id`, userID, by, reason, at, expires).Scan(&id)
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

// standingBan is the ban of the user that binds at now with who gave it, nil without one; of
// overlapping bans the one that ends last, as the viewer gets it.
func (f *Forum) standingBan(ctx context.Context, userID int, now time.Time) (*userBan, error) {
	var b userBan
	err := f.db.QueryRow(ctx, `
		SELECT b.created_at, b.reason, b.moderator_id, m.name, b.expires_at
		FROM forum_bans b JOIN users m ON m.id = b.moderator_id
		WHERE b.user_id = $1 AND `+standingBanSQL("$2")+`
		ORDER BY b.expires_at DESC NULLS FIRST, b.id DESC
		LIMIT 1`, userID, now).Scan(&b.At, &b.Reason, &b.ModeratorID, &b.ModeratorName, &b.ExpiresAt)
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
	UserID        int
	UserName      string
	ModeratorID   int
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
	// Locks are the standing locks on a new avatar (extras/users.md), from the host.
	Locks []lockRow
}

// lockRow is a lock on a new avatar in the moderators' list, with the names the forum reads.
type lockRow struct {
	AvatarLock
	UserName      string
	ModeratorName string
}

func (l lockRow) Avatar() avatar {
	return newAvatar("", l.UserName, l.UserID, replyAvatarSize)
}

// avatarLocks are the host's locks with the names of their users and moderators in one query. The
// list is worth less than the bans above it: an error of the host is logged and the list left out.
func (f *Forum) avatarLocks(r *http.Request) ([]lockRow, error) {
	locks, err := f.host.AvatarLocks(r.Context())
	if err != nil {
		f.host.LogError(r, err)
		return nil, nil
	}
	if len(locks) == 0 {
		return nil, nil
	}
	ids := make([]int, 0, 2*len(locks))
	for _, l := range locks {
		ids = append(ids, l.UserID, l.ModeratorID)
	}
	rows, err := f.db.Query(r.Context(), `SELECT id, name FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	names := map[int]string{}
	var id int
	var name string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		names[id] = name
		return nil
	})
	if err != nil {
		return nil, err
	}
	list := make([]lockRow, 0, len(locks))
	for _, l := range locks {
		list = append(list, lockRow{AvatarLock: l, UserName: names[l.UserID], ModeratorName: names[l.ModeratorID]})
	}
	return list, nil
}

// bansPage lists the bans that bind now, the newest first, each with its button to lift it.
func (f *Forum) bansPage(w http.ResponseWriter, r *http.Request, v view) {
	if !f.modOnly(w, r, v) {
		return
	}
	rows, err := f.db.Query(r.Context(), `
		SELECT b.id, u.id, u.name, m.id, m.name, b.reason, b.created_at, b.expires_at, l.post_id
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
	locks, err := f.avatarLocks(r)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	f.render(w, r, http.StatusOK, "bans_mod.html", bansData{view: v, Bans: bans, Locks: locks}, Page{
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
