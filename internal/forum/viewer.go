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
}

func (v Viewer) SignedIn() bool {
	return v.ID != 0
}

// loadViewer reads the signed-in user in one query; of users the forum reads only id, name and
// created_at (_prd/forum/plan.md, amendment 4).
func (f *Forum) loadViewer(ctx context.Context, userID int) (Viewer, error) {
	v := Viewer{ID: userID}
	err := f.db.QueryRow(ctx, `
		SELECT u.name, u.created_at, EXISTS (SELECT 1 FROM forum_moderators m WHERE m.user_id = u.id)
		FROM users u
		WHERE u.id = $1`, userID).Scan(&v.Name, &v.RegisteredAt, &v.Moderator)
	if err != nil {
		// The host signs in only users that exist, so a missing row is an error too.
		return Viewer{}, fmt.Errorf("forum viewer %d: %w", userID, err)
	}
	return v, nil
}

// withView hands every forum handler the view of its request with the viewer loaded; a guest
// costs no query.
func (f *Forum) withView(h func(http.ResponseWriter, *http.Request, view)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v := f.view(r)
		if id, ok := f.host.UserID(r); ok {
			viewer, err := f.loadViewer(r.Context(), id)
			if err != nil {
				f.host.ServerError(w, r, err)
				return
			}
			v.Viewer = viewer
		}
		h(w, r, v)
	}
}
