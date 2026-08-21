package roomws

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"

	"charactersheet.iociveteres.net/internal/models"
)

type WSResponse struct {
	Type    string `json:"type"`              // e.g. "response"
	EventID string `json:"eventID"`           // client event id (optional)
	OK      bool   `json:"OK"`                // true or
	Version int    `json:"version,omitempty"` //
	Code    string `json:"code,omitempty"`    // machine code for errors: "validation","conflict","not_found","internal"
	Message string `json:"message,omitempty"` // small human/dev message (trace only in debug)
}

// wsErrorWithCode returns a typed NACK with specified code
func (app *Server) wsServerError(err error, eventID, code string) json.RawMessage {

	trace := fmt.Sprintf("%s\n%s", err.Error(), debug.Stack())
	app.ErrorLog.Output(2, trace)

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
		app.ErrorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
}

func (app *Server) wsClientError(eventID, code string, status int) json.RawMessage {
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
		app.ErrorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
}

// wsOK builds a success ACK
func (app *Server) wsOK(eventID string, version int) json.RawMessage {
	resp := WSResponse{
		Type:    "response",
		EventID: eventID,
		OK:      true,
		Version: version,
	}

	b, marshalErr := json.Marshal(&resp)
	if marshalErr != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("json.Marshal failed in wsServerError: %v", marshalErr))
		fallback := []byte(`{"type":"response","OK":false,"message":"internal server error"}`)
		return json.RawMessage(fallback)
	}

	return json.RawMessage(b)
}

// wsModelError sends the appropriate reply for a model-layer error.
// Returns true if an error was handled (caller should return).
func (app *Server) wsModelError(hub *Hub, client *Client, err error, eventID, context string) bool {
	if err == nil {
		return false
	}
	if err == models.ErrPermissionDenied || err == models.ErrNoRecord {
		hub.ReplyToClient(client, app.wsClientError(eventID, "permission", http.StatusForbidden))
		return true
	}
	hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("%s: %w", context, err), eventID, "internal"))
	return true
}
