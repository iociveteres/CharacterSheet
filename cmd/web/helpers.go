package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/models"
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

func (app *application) render(w http.ResponseWriter, status int, page string, tplName string, data *templateData) {
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

func (app *application) newTemplateData(r *http.Request) *templateData {
	return &templateData{
		CurrentYear:     time.Now().Year(),
		Flash:           app.sessionManager.PopString(r.Context(), "flash"),
		IsAuthenticated: app.isAuthenticated(r),
		CSRFToken:       nosurf.Token(r),
		TimeZone:        getTimeLocation(r),
	}
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

// parseJSONBPath parses a dot-separated path into a []string for use as
// a PostgreSQL text[] parameter
func parseJSONBPath(dotPath string) []string {
	if dotPath == "" {
		return []string{}
	}

	parts := strings.Split(dotPath, ".")

	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, p := range parts {
		if i > 0 {
			buf.WriteByte(',')
		}

		// Escape backslashes and double quotes for safe array-literal usage
		escaped := strings.ReplaceAll(p, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)

		// If element contains any characters that require quoting in PG array literal,
		// wrap it in double quotes. These include comma, braces, whitespace, backslash, quote.
		if strings.ContainsAny(escaped, ",{} \t\n\"\\") {
			buf.WriteByte('"')
			buf.WriteString(escaped)
			buf.WriteByte('"')
		} else {
			buf.WriteString(escaped)
		}
	}
	buf.WriteByte('}')

	return parts
}

// buildInitFromRelPaths parses a list of relative JSONB paths (e.g. "tabs.tab-1")
// and returns a json.RawMessage representing a nested object with empty objects
// at each final path. Example:
//
//	relPaths := []string{"tabs.tab-1", "meta.foo"}
//
// // -> {"tabs":{"tab-1":{}},"meta":{"foo":{}}}
func buildInitFromRelPaths(relPaths []string) (json.RawMessage, error) {
	root := make(map[string]any)
	added := false

	for _, rel := range relPaths {
		if rel == "" {
			continue
		}
		parts := parseJSONBPath(rel)
		if len(parts) == 0 {
			continue
		}
		added = true

		cur := root
		for i, p := range parts {
			last := i == len(parts)-1
			if last {
				// final element: ensure it's a map (empty object)
				if existing, ok := cur[p]; ok {
					if _, isMap := existing.(map[string]any); !isMap {
						cur[p] = map[string]any{} // overwrite non-map
					}
				} else {
					cur[p] = map[string]any{}
				}
			} else {
				// intermediate element: ensure a map exists and descend
				if next, ok := cur[p]; ok {
					if m, isMap := next.(map[string]any); isMap {
						cur = m
					} else {
						nm := make(map[string]any)
						cur[p] = nm
						cur = nm
					}
				} else {
					nm := make(map[string]any)
					cur[p] = nm
					cur = nm
				}
			}
		}
	}

	if !added {
		return json.RawMessage([]byte(`{}`)), nil
	}

	b, err := json.Marshal(root)
	if err != nil {
		return nil, fmt.Errorf("marshal init object: %w", err)
	}
	return json.RawMessage(b), nil
}

type WSResponse struct {
	Type    string `json:"type"`              // e.g. "response"
	EventID string `json:"eventID"`           // client event id (optional)
	OK      bool   `json:"OK"`                // true or
	Version int    `json:"version,omitempty"` //
	Code    string `json:"code,omitempty"`    // machine code for errors: "validation","conflict","not_found","internal"
	Message string `json:"message,omitempty"` // small human/dev message (trace only in debug)
}

// wsErrorWithCode returns a typed NACK with specified code
func (app *application) wsServerError(err error, eventID, code string) json.RawMessage {

	trace := fmt.Sprintf("%s\n%s", err.Error(), debug.Stack())
	app.errorLog.Output(2, trace)

	msg := http.StatusText(http.StatusInternalServerError)
	if app.debug && trace != "" {
		msg = trace
	}

	resp := WSResponse{
		Type:    "response",
		EventID: eventID,
		OK:      false,
		Code:    code,
		Message: msg,
	}

	b, marshalErr := json.Marshal(&resp)
	if marshalErr != nil {
		app.errorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
}

func (app *application) wsClientError(eventID, code string, status int) json.RawMessage {
	msg := http.StatusText(status)

	resp := WSResponse{
		Type:    "response",
		EventID: eventID,
		OK:      false,
		Code:    code,
		Message: msg,
	}

	b, marshalErr := json.Marshal(&resp)
	if marshalErr != nil {
		app.errorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
}

// wsOK builds a success ACK
func (app *application) wsOK(eventID string, version int) json.RawMessage {
	resp := WSResponse{
		Type:    "response",
		EventID: eventID,
		OK:      true,
		Version: version,
	}

	b, marshalErr := json.Marshal(&resp)
	if marshalErr != nil {
		app.errorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
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

func getTimeLocation(r *http.Request) *time.Location {
	c, err := r.Cookie("tz")
	if err != nil {
		return nil
	}
	tz, err := url.QueryUnescape(c.Value)
	if err != nil {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	return loc
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
