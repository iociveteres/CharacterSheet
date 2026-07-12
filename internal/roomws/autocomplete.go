package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
)

type autocompleteMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	Collection string `json:"collection"` // e.g. "advancements"
	Query      string `json:"query"`
	Filter     string `json:"filter,omitempty"` // optional; collection-specific subtype filter
}

func (app *Server) autocompleteQueryHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg autocompleteMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(
			fmt.Errorf("unmarshal autocomplete: %w", err), "", "validation",
		))
		return
	}

	if app.Gamedata == nil {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
		return
	}

	resultsJSON, err := app.searchCollection(msg.Collection, msg.Query)
	if err != nil {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
		return
	}

	type response struct {
		Type       string          `json:"type"`
		EventID    string          `json:"eventID"`
		Collection string          `json:"collection"`
		Results    json.RawMessage `json:"results"`
	}

	b, err := json.Marshal(response{
		Type:       "autocompleteResult",
		EventID:    msg.EventID,
		Collection: msg.Collection,
		Results:    resultsJSON,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(
			fmt.Errorf("marshal autocomplete response: %w", err), msg.EventID, "internal",
		))
		return
	}

	hub.ReplyToClient(client, b)
}

type autocompleteApplyMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	SheetID    string `json:"sheetID"`
	Path       string `json:"path"`
	Collection string `json:"collection"`
	Name       string `json:"name"`
}

func (app *Server) autocompleteApplyHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg autocompleteApplyMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal autocompleteApply: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	path := models.ParseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	if app.Gamedata == nil {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
		return
	}

	changesJSON, ok := app.getClientJSON(msg.Collection, msg.Name)
	if !ok {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
		return
	}

	version, err := app.Models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, changesJSON)
	if app.wsModelError(hub, client, err, msg.EventID, "autocompleteApply batch") {
		return
	}

	app.InfoLog.Printf("autocompleteApply: sheet=%d path=%s collection=%s name=%s", sheetID, msg.Path, msg.Collection, msg.Name)

	type batchBroadcast struct {
		Type    string          `json:"type"`
		EventID string          `json:"eventID"`
		SheetID string          `json:"sheetID"`
		Path    string          `json:"path"`
		Changes json.RawMessage `json:"changes"`
		Version int             `json:"version"`
	}

	broadcast, err := json.Marshal(batchBroadcast{
		Type:    "autocompleteApplied",
		EventID: msg.EventID,
		SheetID: msg.SheetID,
		Path:    msg.Path,
		Changes: changesJSON,
		Version: version,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal batch broadcast: %w", err), msg.EventID, "internal"))
		return
	}

	hub.BroadcastAll(broadcast)
}

func (app *Server) searchCollection(collection, query string) (json.RawMessage, error) {
	g := app.Gamedata
	switch collection {
	case "advancements":
		if g.Advancements == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.Advancements.Search(query, 10))
	case "gear":
		if g.Gear == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.Gear.Search(query, 10))
	case "cybernetics":
		if g.Cybernetics == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.Cybernetics.Search(query, 10))
	case "melee":
		if g.Melee == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.Melee.Search(query, 10))
	case "psychicPowers":
		if g.PsychicPowers == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.PsychicPowers.Search(query, 10))
	case "ranged":
		if g.Ranged == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.Ranged.Search(query, 10))
	case "techPowers":
		if g.TechPowers == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(g.TechPowers.Search(query, 10))
	default:
		idx, ok := g.Collections[collection]
		if !ok {
			return nil, fmt.Errorf("unknown collection %q", collection)
		}
		if idx == nil {
			return emptyJSONArray, nil
		}
		return json.Marshal(idx.Search(query, 10))
	}
}

func (app *Server) getClientJSON(collection, name string) (json.RawMessage, bool) {
	g := app.Gamedata
	switch collection {
	case "advancements":
		e := g.Advancements.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "gear":
		e := g.Gear.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "cybernetics":
		e := g.Cybernetics.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "melee":
		e := g.Melee.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "psychicPowers":
		e := g.PsychicPowers.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "ranged":
		e := g.Ranged.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	case "techPowers":
		e := g.TechPowers.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	default:
		idx, ok := g.Collections[collection]
		if !ok || idx == nil {
			return nil, false
		}
		e := idx.GetByName(name)
		if e == nil {
			return nil, false
		}
		return e.ClientJSON(), true
	}
}

var emptyJSONArray = json.RawMessage(`[]`)
