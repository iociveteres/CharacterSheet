package webapp

import (
	"bytes"
	"errors"
	"image"
	_ "image/jpeg"
	"io"
	"net/http"
	"regexp"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/julienschmidt/httprouter"
	_ "golang.org/x/image/webp"
)

// The size the client crops a portrait to (sheet/blocks/PortraitEditor.tsx).
const portraitWidth, portraitHeight = 360, 480

var portraitHash = regexp.MustCompile(`^[0-9a-f]{16}$`)

// portraitGet serves GET /portrait/:hash. The URL changes with the image, so
// the browser keeps it for good; private, as only the viewers of a sheet may
// see it. secureHeaders sets nosniff.
func (app *Application) portraitGet(w http.ResponseWriter, r *http.Request) {
	hash := httprouter.ParamsFromContext(r.Context()).ByName("hash")
	if !portraitHash.MatchString(hash) {
		app.notFound(w)
		return
	}
	p, err := app.Models.Portraits.Get(r.Context(), app.userID(r), hash)
	if errors.Is(err, models.ErrNoRecord) {
		app.notFound(w)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", p.Mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Write(p.Data)
}

// portraitMime is the type of a WebP or JPEG image of the portrait's size,
// read from its header; "" for anything else.
func portraitMime(data []byte) string {
	var mime string
	switch {
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		mime = "image/webp"
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		mime = "image/jpeg"
	default:
		return ""
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || "image/"+format != mime || config.Width != portraitWidth || config.Height != portraitHeight {
		return ""
	}
	return mime
}

// portraitPut serves PUT /sheet/portrait/:id: the body is the image itself.
// It answers with no content: the hash comes to every tab, this one too, in
// portraitChanged over the socket.
func (app *Application) portraitPut(w http.ResponseWriter, r *http.Request) {
	sheetID, ok := app.idParam(w, r)
	if !ok {
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, models.PortraitMaxBytes))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		app.clientError(w, http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	mime := portraitMime(data)
	if mime == "" {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	hash, err := app.Models.Portraits.Put(r.Context(), app.userID(r), sheetID, mime, data)
	if errors.Is(err, models.ErrInvalidPortrait) {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	if app.bestiaryError(w, err) {
		return
	}
	app.WSServer.PortraitChanged(r.Context(), sheetID, &hash)
	w.WriteHeader(http.StatusNoContent)
}

// portraitDelete serves DELETE /sheet/portrait/:id.
func (app *Application) portraitDelete(w http.ResponseWriter, r *http.Request) {
	sheetID, ok := app.idParam(w, r)
	if !ok {
		return
	}
	if app.bestiaryError(w, app.Models.Portraits.Delete(r.Context(), app.userID(r), sheetID)) {
		return
	}
	app.WSServer.PortraitChanged(r.Context(), sheetID, nil)
	w.WriteHeader(http.StatusNoContent)
}
