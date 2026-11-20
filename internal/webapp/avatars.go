package webapp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
)

// The size the client crops an avatar to (AVATAR in ui/static/js/account/Avatar.tsx).
const avatarSide = 192

// avatarURL is where GET /avatar/:hash serves the image of the hash.
func avatarURL(hash string) string {
	return "/avatar/" + hash
}

// avatarGet serves GET /avatar/:hash to anyone, guests too: an avatar is
// public, shown beside its user's posts on the forum. The URL changes with
// the image, so any cache may keep it for good. secureHeaders sets nosniff.
func (app *Application) avatarGet(w http.ResponseWriter, r *http.Request) {
	hash := httprouter.ParamsFromContext(r.Context()).ByName("hash")
	if !imageHash.MatchString(hash) {
		app.notFound(w)
		return
	}
	a, err := app.Models.Avatars.Get(r.Context(), hash)
	if errors.Is(err, models.ErrNoRecord) {
		app.notFound(w)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", a.Mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Write(a.Data)
}

// avatarPut serves PUT /account/avatar: the body is the image itself, cropped
// by the Account page. It answers with the image's URL, which the page shows
// in place of the upload.
func (app *Application) avatarPut(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, models.AvatarMaxBytes))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		app.clientError(w, http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	mime := croppedImageMime(data, avatarSide, avatarSide)
	if mime == "" || carriesMetadata(mime, data) {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	hash, err := app.Models.Avatars.Put(r.Context(), app.userID(r), mime, data)
	switch {
	case errors.Is(err, models.ErrAvatarLocked):
		app.clientError(w, http.StatusForbidden)
		return
	case errors.Is(err, models.ErrInvalidAvatar):
		app.clientError(w, http.StatusBadRequest)
		return
	case err != nil:
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		URL string `json:"url"`
	}{avatarURL(hash)})
}

// avatarDelete serves DELETE /account/avatar, the Account page's Delete.
func (app *Application) avatarDelete(w http.ResponseWriter, r *http.Request) {
	if err := app.Models.Avatars.Delete(r.Context(), app.userID(r)); err != nil {
		app.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// avatarDeletePost serves POST /account/avatar/delete: Delete of the Account
// page without its script, a plain form that comes back to the page.
func (app *Application) avatarDeletePost(w http.ResponseWriter, r *http.Request) {
	if err := app.Models.Avatars.Delete(r.Context(), app.userID(r)); err != nil {
		app.serverError(w, err)
		return
	}
	http.Redirect(w, r, reverse.Rev("AccountView")+"#avatar", http.StatusSeeOther)
}
