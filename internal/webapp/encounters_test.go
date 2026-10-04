package webapp

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

// encounterFile is a file of one NPC named `name` (mocks.EncounterModel
// refuses "Too big").
func encounterFile(name string) string {
	return `{"format": "encounter", "version": 1, "name": "` + name + `", "round": 2, "groups": [],
        "npcs": [{"content": {"characterInfo": {"characterName": "Ork Boy"}}}]}`
}

// multipartFiles is a form of `fields` and of files under `field`, in order.
func multipartFiles(t *testing.T, fields map[string]string, field string, files [][2]string) (string, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		w.WriteField(k, v)
	}
	for _, f := range files {
		part, err := w.CreateFormFile(field, f[0])
		if err != nil {
			t.Fatal(err)
		}
		part.Write([]byte(f[1]))
	}
	w.Close()
	return w.FormDataContentType(), &buf
}

func TestEncounterView(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)

	sheets := func(url string) int {
		t.Helper()
		code, _, body := ts.get(t, url)
		assert.Equal(t, code, http.StatusOK)
		var payload encounterPayload
		if err := json.Unmarshal([]byte(body), &payload); err != nil {
			t.Fatal(err)
		}
		return len(payload.Sheets)
	}
	assert.Equal(t, sheets("/encounter/1"), 1)
	// Sheet 1 is on the client's page already.
	assert.Equal(t, sheets("/encounter/1?have=7,1"), 0)
	assert.Equal(t, sheets("/encounter/1?have=7,x"), 1)
}

func TestEncounterExport(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)

	code, header, body := ts.get(t, "/encounter/1/export")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, header.Get("Content-Disposition"), `attachment; filename="Mock encounter_`)
	assert.StringContains(t, body, `"format": "encounter"`)

	// User 1 is no gamemaster of the room of encounter 2 (mocks.EncounterModel).
	code, _, _ = ts.get(t, "/encounter/2/export")
	assert.Equal(t, code, http.StatusForbidden)
	code, _, _ = ts.get(t, "/encounter/3/export")
	assert.Equal(t, code, http.StatusNotFound)
}

func TestEncountersLoad(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	encounters := app.Models.Encounters.(*mocks.EncounterModel)

	load := func(room string, files ...[2]string) (int, []map[string]any) {
		t.Helper()
		contentType, body := multipartFiles(t, map[string]string{"room_id": room}, "files", files)
		code, _, resp := ts.send(t, http.MethodPost, "/encounters/load", contentType, body, token)
		var results []map[string]any
		if code == http.StatusOK {
			if err := json.Unmarshal([]byte(resp), &results); err != nil {
				t.Fatal(err)
			}
		}
		return code, results
	}

	code, results := load("1", [2]string{"ambush.json", encounterFile("Ambush")}, [2]string{"notes.txt", "not a file"},
		[2]string{"raid.json", encounterFile("Raid")})
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, len(results), 3)
	assert.Equal(t, results[0]["file"], "ambush.json")
	assert.Equal(t, results[0]["name"], "Ambush")
	assert.Equal(t, results[0]["npcs"].(float64), 1)
	assert.Equal(t, results[1]["error"], "invalid")
	assert.Equal(t, results[2]["name"], "Raid")
	assert.Equal(t, strings.Join(encounters.Loaded, ","), "Ambush,Raid")

	// The file over the quota stops the loading: the one after it is not tried.
	code, results = load("1", [2]string{"a.json", encounterFile("A")}, [2]string{"big.json", encounterFile("Too big")},
		[2]string{"b.json", encounterFile("B")})
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, len(results), 2)
	assert.Equal(t, results[1]["error"], "quota")
	assert.StringContains(t, results[1]["message"].(string), "NPCs and creatures take")
	assert.Equal(t, strings.Join(encounters.Loaded, ","), "Ambush,Raid,A")

	code, _ = load("2", [2]string{"c.json", encounterFile("C")})
	assert.Equal(t, code, http.StatusForbidden)
	code, _ = load("", [2]string{"c.json", encounterFile("C")})
	assert.Equal(t, code, http.StatusBadRequest)
	assert.Equal(t, len(encounters.Loaded), 3)
}

func TestEncounterReplaceNpcs(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	replace := func(path string, file string) (int, string) {
		t.Helper()
		contentType, body := multipartFiles(t, nil, "file", [][2]string{{"ambush.json", file}})
		code, _, resp := ts.send(t, http.MethodPost, path, contentType, body, token)
		return code, resp
	}

	code, body := replace("/encounter/1/npcs", encounterFile("Ambush"))
	assert.Equal(t, code, http.StatusOK)
	var state struct {
		ID, Round    int
		Participants []struct{ NPC bool }
	}
	if err := json.Unmarshal([]byte(body), &state); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, state.ID, 1)
	assert.Equal(t, state.Round, 2)
	assert.Equal(t, len(state.Participants), 1)

	code, _ = replace("/encounter/1/npcs", `{"format": "collection"}`)
	assert.Equal(t, code, http.StatusBadRequest)
	code, _ = replace("/encounter/2/npcs", encounterFile("Ambush"))
	assert.Equal(t, code, http.StatusForbidden)
	code, _ = replace("/encounter/3/npcs", encounterFile("Ambush"))
	assert.Equal(t, code, http.StatusNotFound)
}

func TestAddVariant(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	code, _, body := ts.send(t, http.MethodPost, "/bestiary/add-variant", "application/json", strings.NewReader(`{"sheetId":1,"name":"Ork Nob"}`), token)
	assert.Equal(t, code, http.StatusCreated)
	assert.StringContains(t, body, `"name":"Ork Nob"`)

	// An NPC without a creature of the user's own.
	code, _, _ = ts.send(t, http.MethodPost, "/bestiary/add-variant", "application/json", strings.NewReader(`{"sheetId":2,"name":""}`), token)
	assert.Equal(t, code, http.StatusBadRequest)
	code, _, _ = ts.send(t, http.MethodPost, "/bestiary/update-source", "application/json", strings.NewReader(`{"sheetId":1}`), token)
	assert.Equal(t, code, http.StatusNotFound)
}
