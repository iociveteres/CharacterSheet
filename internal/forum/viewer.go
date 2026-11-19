package forum

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Viewer is who opens a forum page; the zero Viewer is a guest. What it may do is asked of
// rights.go, not of its fields.
type Viewer struct {
	ID           int
	Name         string
	RegisteredAt time.Time
	Moderator    bool
	// Ban is the standing ban of the viewer, nil without one. Ask Banned, not this field: a ban
	// does not bind a moderator.
	Ban *Ban
}

// Ban is a standing ban: not lifted and not yet expired.
type Ban struct {
	ID        int
	Reason    string
	CreatedAt time.Time
	// ExpiresAt is nil for a ban until lifted.
	ExpiresAt *time.Time
}

func (v Viewer) SignedIn() bool {
	return v.ID != 0
}

// loadViewer reads the signed-in user with their standing ban at the time now in one query; of
// users the forum reads only id, name and created_at (_prd/forum/plan.md, amendment 4).
func (f *Forum) loadViewer(ctx context.Context, userID int, now time.Time) (Viewer, error) {
	v := Viewer{ID: userID}
	// The columns of the ban are NULL without one.
	var banID *int
	var banReason *string
	var banCreatedAt *time.Time
	var ban Ban
	err := f.db.QueryRow(ctx, `
		SELECT u.name, u.created_at, EXISTS (SELECT 1 FROM forum_moderators m WHERE m.user_id = u.id),
		       b.id, b.reason, b.created_at, b.expires_at
		FROM users u
		LEFT JOIN LATERAL (
			-- Of overlapping bans the one that ends last; one until lifted ends never.
			SELECT id, reason, created_at, expires_at FROM forum_bans
			WHERE user_id = u.id AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)
			ORDER BY expires_at DESC NULLS FIRST, id DESC
			LIMIT 1
		) b ON true
		WHERE u.id = $1`, userID, now).
		Scan(&v.Name, &v.RegisteredAt, &v.Moderator, &banID, &banReason, &banCreatedAt, &ban.ExpiresAt)
	if err != nil {
		// The host signs in only users that exist, so a missing row is an error too.
		return Viewer{}, fmt.Errorf("forum viewer %d: %w", userID, err)
	}
	if banID != nil {
		ban.ID, ban.Reason, ban.CreatedAt = *banID, *banReason, *banCreatedAt
		v.Ban = &ban
	}
	return v, nil
}

// withView hands every forum handler the view of its request with the viewer loaded; a guest
// costs no query.
func (f *Forum) withView(h func(http.ResponseWriter, *http.Request, view)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v := f.view(r)
		if id, ok := f.host.UserID(r); ok {
			viewer, err := f.loadViewer(r.Context(), id, v.Now)
			if err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			v.Viewer = viewer
		}
		h(w, r, v)
	}
}
