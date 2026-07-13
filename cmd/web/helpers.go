package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"github.com/go-playground/form/v4"
	"github.com/justinas/nosurf"
)

func (app *application) serverError(w http.ResponseWriter, err error) {
	trace := fmt.Sprintf("%s\n%s", err.Error(), debug.Stack())
	app.errorLog.Output(2, trace)

	if app.debug {
		http.Error(w, trace, http.StatusInternalServerError)
		return
	}

	http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
}

func (app *application) clientError(w http.ResponseWriter, status int) {
	http.Error(w, http.StatusText(status), status)
}

func (app *application) notFound(w http.ResponseWriter) {
	app.clientError(w, http.StatusNotFound)
}

func (app *application) isAuthenticated(r *http.Request) bool {
	isAuthenticated, ok := r.Context().Value(isAuthenticatedContextKey).(bool)
	if !ok {
		return false
	}
	return isAuthenticated
}

func (app *application) render(w http.ResponseWriter, status int, page string, tplName string, data *templates.Data) {
	ts, ok := app.templateCache[page]
	if !ok {
		err := fmt.Errorf("the template %s does not exist", page)
		app.serverError(w, err)
		return
	}

	buf := new(bytes.Buffer)
	if err := ts.ExecuteTemplate(buf, tplName, data); err != nil {
		app.serverError(w, err)
		return
	}

	w.WriteHeader(status)
	buf.WriteTo(w)
}

func (app *application) newTemplateData(r *http.Request) *templates.Data {
	nonce, _ := r.Context().Value("csp-nonce").(string)

	return &templates.Data{
		CurrentYear:     time.Now().Year(),
		Flash:           app.sessionManager.PopString(r.Context(), "flash"),
		IsAuthenticated: app.isAuthenticated(r),
		CSRFToken:       nosurf.Token(r),
		TimeZone:        util.GetTimeLocation(r),
		Nonce:           nonce,
	}
}

func generateNonce() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

func (app *application) decodePostForm(r *http.Request, dst any) error {
	err := r.ParseForm()
	if err != nil {
		return err
	}

	err = app.formDecoder.Decode(dst, r.PostForm)
	if err != nil {
		// If we try to use an invalid target destination, the Decode() method
		// will return an error with the type *form.InvalidDecoderError.We use
		// errors.As() to check for this and raise a panic rather than returning
		// the error.
		var invalidDecoderError *form.InvalidDecoderError
		if errors.As(err, &invalidDecoderError) {
			panic(err)
		}
		// For all other errors, we return them as normal.
		return err
	}
	return nil
}

// extractPlayerByUserID finds the player with given userID, returns a pointer to it
// and a slice with that player removed (preserves order). If not found, selected is nil
// and rest is the original slice.
func extractPlayerByUserID(players []*models.PlayerView, userID int) (selected *models.PlayerView, rest []*models.PlayerView) {
	for i := range players {
		if players[i].User.ID == userID {
			selected = players[i]
			rest = append(players[:i], players[i+1:]...)
			players[len(players)-1] = nil
			return selected, rest
		}
	}
	return nil, players
}

func getOrigin(r *http.Request) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (app *application) background(fn func()) {
	app.wg.Add(1)

	go func() {
		defer func() {
			if err := recover(); err != nil {
				app.errorLog.Output(2, fmt.Sprintf("%s", err))
			}
		}()

		fn()
	}()
}
