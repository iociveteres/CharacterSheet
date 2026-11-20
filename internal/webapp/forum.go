package webapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"github.com/justinas/nosurf"
	"github.com/alehano/reverse"
)

// ForumService is forum.Forum; tests put a fake in its place.
type ForumService interface {
	Handler() http.Handler
	UnreadNotifications(ctx context.Context, userID int) (int, error)
}

// forumBadge is templates.Data.ForumBadge: the nav asks the forum for the counter only when it is
// drawn, and only for a signed-in user. The counter is worth less than the page: an error is logged
// and the page served without it.
func (app *Application) forumBadge(r *http.Request) func() string {
	if !app.isAuthenticated(r) {
		return nil
	}
	return func() string {
		n, err := app.Forum.UnreadNotifications(r.Context(), app.userID(r))
		if err != nil && !errors.Is(err, context.Canceled) {
			app.ErrorLog.Output(2, fmt.Sprintf("forum unread notifications %s %s: %v", r.Method, r.URL.Path, err))
		}
		return forum.Badge(n)
	}
}

// ForumHost is what forum.New takes from the app; the forum is made after the app for it.
func (app *Application) ForumHost() forum.Host {
	return forumHost{app}
}

type forumHost struct {
	app *Application
}

func (h forumHost) UserID(r *http.Request) (int, bool) {
	if !h.app.isAuthenticated(r) {
		return 0, false
	}
	return h.app.userID(r), true
}

func (h forumHost) CSRFToken(r *http.Request) string {
	return nosurf.Token(r)
}

func (h forumHost) PutFlash(r *http.Request, text string) {
	h.app.SessionManager.Put(r.Context(), "flash", text)
}

func (h forumHost) Render(w http.ResponseWriter, r *http.Request, status int, page forum.Page) {
	data := h.app.newTemplateData(r)
	data.Embedded = &templates.EmbeddedPage{
		Title:       page.Title,
		Description: page.Description,
		Canonical:   page.Canonical,
		NoIndex:     page.NoIndex,
		Styles:      []string{"css/forum.css"},
		// Only improves what the forms already do: every page works without it.
		Scripts: []string{"dist/forum.js"},
		// Wider than the site's 800px, header and nav keep theirs (forum.css).
		MainClass: "forum-wide",
		Body:      page.Body,
	}
	// Posts link pictures from any https host (forum's images.go).
	if page.ImagesFromAnyHost {
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy(imgSrc+" https:"))
	}
	h.app.render(w, status, "embedded.html", "base", data)
}

func (h forumHost) ServerError(w http.ResponseWriter, r *http.Request, err error) {
	h.app.serverError(w, err)
}

func (h forumHost) LogError(r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.app.ErrorLog.Output(2, fmt.Sprintf("forum %s %s: %v", r.Method, r.URL.Path, err))
}

func (h forumHost) NotFound(w http.ResponseWriter, r *http.Request) {
	h.app.notFound(w)
}

func (h forumHost) RedirectToLogin(w http.ResponseWriter, r *http.Request) {
	h.app.redirectToLogin(w, r)
}

func (h forumHost) Avatars(ctx context.Context, userIDs []int) (map[int]string, error) {
	hashes, err := h.app.Models.Avatars.Hashes(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	urls := make(map[int]string, len(hashes))
	for id, hash := range hashes {
		urls[id] = avatarURL(hash)
	}
	return urls, nil
}

func (h forumHost) AvatarState(ctx context.Context, userID int) (forum.AvatarState, error) {
	var state forum.AvatarState
	hashes, err := h.app.Models.Avatars.Hashes(ctx, []int{userID})
	if err != nil {
		return state, err
	}
	if hash, ok := hashes[userID]; ok {
		state.URL = avatarURL(hash)
	}
	lock, err := h.app.Models.Avatars.LockOf(ctx, userID)
	if err != nil {
		return state, err
	}
	if lock != nil {
		l := forumAvatarLock(*lock)
		state.Lock = &l
	}
	return state, nil
}

func forumAvatarLock(l models.AvatarLock) forum.AvatarLock {
	return forum.AvatarLock{UserID: l.UserID, Until: l.Until, Reason: l.Reason, ModeratorID: l.ModeratorID, CreatedAt: l.CreatedAt}
}

func (h forumHost) RemoveAvatar(ctx context.Context, userID int, lock *forum.AvatarLock) error {
	var l *models.AvatarLock
	if lock != nil {
		l = &models.AvatarLock{UserID: userID, Until: lock.Until, Reason: lock.Reason, ModeratorID: lock.ModeratorID}
	}
	return h.app.Models.Avatars.Remove(ctx, userID, l)
}

func (h forumHost) LiftAvatarLock(ctx context.Context, userID int) error {
	return h.app.Models.Avatars.Unlock(ctx, userID)
}

func (h forumHost) AvatarLocks(ctx context.Context) ([]forum.AvatarLock, error) {
	locks, err := h.app.Models.Avatars.Locks(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]forum.AvatarLock, len(locks))
	for i, l := range locks {
		out[i] = forumAvatarLock(l)
	}
	return out, nil
}

// AccountURL is the block «Avatar» of the Account page.
func (h forumHost) AccountURL() string {
	return reverse.Rev("AccountView") + "#avatar"
}
