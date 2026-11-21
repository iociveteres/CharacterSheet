package webapp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func exports(app *Application) *mocks.DataExportModel {
	return app.Models.DataExports.(*mocks.DataExportModel)
}

// readyExport puts a ready archive of the user into the export folder.
func readyExport(t *testing.T, app *Application, userID int, requested time.Duration, content string) string {
	t.Helper()
	name := "export-" + time.Now().Format("150405.000000000") + ".zip"
	if err := os.WriteFile(filepath.Join(app.ExportDir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	readyAt := time.Now().Add(-requested)
	exports(app).Put(userID, models.DataExport{
		State: models.ExportReady, RequestedAt: readyAt, ReadyAt: &readyAt, FileName: name, Size: int64(len(content)),
	})
	return name
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// The archive holds the user's files: sheets and NPCs in the format of /sheet/export, collections
// in that of their export, so that both load back; no scene.
func TestExportArchive(t *testing.T) {
	app := newTestApplication(t)
	var buf bytes.Buffer
	if err := app.writeArchive(context.Background(), &buf, 1, time.Now()); err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[f.Name] = b
	}
	var names []string
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	want := []string{
		"README.txt", "account.json", "bestiary/Orks-1.json", "chat.json",
		"forum/posts.json", "forum/profile.json", "forum/topics.json", "moderation.json",
		"npcs/Room_1/Cultist-5.json", "portraits/" + mocks.AlicePortrait + ".webp", "rooms.json",
		"sheets/Room_1/Hero-1.json",
	}
	if !slices.Equal(names, want) {
		t.Fatalf("files\n%v\nwant\n%v", names, want)
	}

	for _, name := range []string{"sheets/Room_1/Hero-1.json", "npcs/Room_1/Cultist-5.json"} {
		content, kind, _, err := sheetOfFile(files[name])
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		assert.Equal(t, kind, models.DefaultSheetKind)
		if !json.Valid(content) {
			t.Errorf("%s: content %s", name, content)
		}
	}
	creatures, err := creaturesOfFile(files["bestiary/Orks-1.json"])
	if err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, len(creatures), 1)

	for _, name := range []string{"account.json", "rooms.json", "forum/profile.json", "moderation.json"} {
		if !json.Valid(files[name]) {
			t.Errorf("%s is no JSON: %s", name, files[name])
		}
	}
	lengths := map[string]int{"chat.json": 1, "forum/posts.json": 1, "forum/topics.json": 0}
	for name, n := range lengths {
		var items []json.RawMessage
		if err := json.Unmarshal(files[name], &items); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, files[name])
		}
		if len(items) != n || items == nil {
			t.Errorf("%s: %d items, want %d", name, len(items), n)
		}
	}
	if len(files["README.txt"]) == 0 {
		t.Error("README.txt is empty")
	}
}

func TestPathName(t *testing.T) {
	tests := map[string]string{
		"Room/1":                "Room_1",
		` a\b:c*d?e"f<g>h|i `:   "a_b_c_d_e_f_g_h_i",
		"":                      "_",
		"..":                    "_",
		"Комната":               "Комната",
		strings.Repeat("я", 70): strings.Repeat("я", 60),
	}
	for in, want := range tests {
		assert.Equal(t, pathName(in), want)
	}
}

// The page follows the export through its states: it reloads itself only while the archive is
// on its way, and offers the download of a ready one.
func TestExportPage(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	const refresh = `http-equiv="refresh"`

	code, _, body := ts.get(t, "/account/export")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `data-state=""`)
	if strings.Contains(body, refresh) {
		t.Error("the page without an export reloads itself")
	}

	code, header, _ := ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/export")
	assert.Equal(t, exports(app).State(1), models.ExportQueued)
	for _, state := range []string{models.ExportQueued, models.ExportBuilding} {
		exports(app).Put(1, models.DataExport{State: state, RequestedAt: time.Now()})
		_, _, body = ts.get(t, "/account/export")
		assert.StringContains(t, body, `data-state="`+state+`"`)
		assert.StringContains(t, body, refresh)
	}

	readyExport(t, app, 1, time.Minute, "zip")
	_, _, body = ts.get(t, "/account/export")
	assert.StringContains(t, body, `data-state="ready"`)
	assert.StringContains(t, body, `href='/account/export/download'`)
	if strings.Contains(body, refresh) {
		t.Error("the page of a ready archive reloads itself")
	}

	exports(app).Put(1, models.DataExport{State: models.ExportFailed, RequestedAt: time.Now()})
	_, _, body = ts.get(t, "/account/export")
	assert.StringContains(t, body, `data-state="failed"`)
	assert.StringContains(t, body, `action='/account/export'`)

	// An archive gone with a restart is no archive, and holds nothing back.
	name := readyExport(t, app, 1, time.Minute, "zip")
	os.Remove(filepath.Join(app.ExportDir, name))
	_, _, body = ts.get(t, "/account/export")
	assert.StringContains(t, body, `data-state=""`)
	ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, exports(app).State(1), models.ExportQueued)
}

// A new archive may be built 30 minutes after the last; a failed build does not count.
func TestExportLimit(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	readyExport(t, app, 1, time.Minute, "zip")
	code, header, _ := ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/export")
	assert.Equal(t, exports(app).State(1), models.ExportReady)
	_, _, body := ts.get(t, "/account/export")
	if strings.Contains(body, `action='/account/export'`) {
		t.Error("the page offers a new archive within 30 minutes")
	}

	old := readyExport(t, app, 1, 31*time.Minute, "zip")
	ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, exports(app).State(1), models.ExportQueued)
	if exists(filepath.Join(app.ExportDir, old)) {
		t.Error("the archive replaced by a new one is still there")
	}

	exports(app).Put(1, models.DataExport{State: models.ExportFailed, RequestedAt: time.Now()})
	ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, exports(app).State(1), models.ExportQueued)
}

// The download serves the archive of the session's user and nobody else's.
func TestExportDownload(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)

	readyExport(t, app, 2, time.Minute, "bob's")
	code, _, body := ts.get(t, "/account/export/download")
	assert.Equal(t, code, http.StatusNotFound)
	if strings.Contains(body, "bob's") {
		t.Error("another user's archive was served")
	}

	readyExport(t, app, 1, time.Minute, "alice's")
	code, header, body := ts.get(t, "/account/export/download")
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, body, "alice's")
	assert.Equal(t, header.Get("Content-Type"), "application/zip")
	assert.StringContains(t, header.Get("Content-Disposition"), "attachment")

	guest := ts.otherBrowser(t)
	code, header, _ = guest.get(t, "/account/export/download")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
}

// An account in the grace period of its deletion may take its data.
func TestExportInGracePeriod(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	token := ts.csrfOf(t, "/user/login")
	code, header, _ := ts.postForm(t, "/user/login", url.Values{"email": {"alice@example.com"}, "password": {"pa$$word"}, "csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/deletion")

	_, _, body := ts.get(t, "/account/deletion")
	assert.StringContains(t, body, `href='/account/export'`)
	code, _, body = ts.get(t, "/account/export")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `href='/account/deletion'`)
	code, _, _ = ts.postForm(t, "/account/export", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, exports(app).State(1), models.ExportQueued)
	readyExport(t, app, 1, time.Minute, "zip")
	code, _, _ = ts.get(t, "/account/export/download")
	assert.Equal(t, code, http.StatusOK)

	// Once the deletion is done, the key opens nothing.
	if _, err := users(app).Wipe(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	code, header, _ = ts.get(t, "/account/export")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
}

// waitFor waits until cond holds, for up to 5 seconds.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func statesOf(m *mocks.DataExportModel, users ...int) map[string]int {
	n := map[string]int{}
	for _, u := range users {
		n[m.State(u)]++
	}
	return n
}

// With two workers, a third export waits in the queue while two are built.
func TestExportWorkers(t *testing.T) {
	app := newTestApplication(t)
	app.ExportWorkers = 2
	m := exports(app)
	m.Hold = make(chan struct{})
	for _, u := range []int{1, 2, 3} {
		m.Put(u, models.DataExport{State: models.ExportQueued, RequestedAt: time.Now()})
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer func() {
		cancel()
		app.Wait()
	}()
	app.startExportWorkers(ctx)

	waitFor(t, "two builds", func() bool { return statesOf(m, 1, 2, 3)[models.ExportBuilding] == 2 })
	time.Sleep(100 * time.Millisecond)
	if n := statesOf(m, 1, 2, 3); n[models.ExportBuilding] != 2 || n[models.ExportQueued] != 1 {
		t.Fatalf("states %v, want 2 building and 1 queued", n)
	}
	assert.Equal(t, m.State(3), models.ExportQueued)

	close(m.Hold)
	waitFor(t, "three archives", func() bool { return statesOf(m, 1, 2, 3)[models.ExportReady] == 3 })
	for _, u := range []int{1, 2, 3} {
		e, err := m.Get(context.Background(), u)
		if err != nil {
			t.Fatal(err)
		}
		if !exists(filepath.Join(app.ExportDir, e.FileName)) || e.Size == 0 {
			t.Errorf("user %d: archive %q of %d bytes", u, e.FileName, e.Size)
		}
	}

	// A new request wakes an idle worker without waiting for its poll.
	m.Put(4, models.DataExport{State: models.ExportQueued, RequestedAt: time.Now()})
	app.wakeExports()
	waitFor(t, "the fourth archive", func() bool { return m.State(4) == models.ExportReady })
}

// A build cut short by the server's stop leaves no file and goes back into the queue.
func TestExportWorkersStop(t *testing.T) {
	app := newTestApplication(t)
	app.ExportWorkers = 1
	m := exports(app)
	m.Hold = make(chan struct{})
	m.Put(1, models.DataExport{State: models.ExportQueued, RequestedAt: time.Now()})
	ctx, cancel := context.WithCancel(context.Background())
	app.startExportWorkers(ctx)
	waitFor(t, "the build", func() bool { return m.State(1) == models.ExportBuilding })

	cancel()
	app.Wait()
	assert.Equal(t, m.State(1), models.ExportQueued)
	left, err := os.ReadDir(app.ExportDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("files left: %v", left)
	}

	// At the next start what was being built is queued again.
	m.Put(2, models.DataExport{State: models.ExportBuilding, RequestedAt: time.Now()})
	n, err := m.RequeueBuilding(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("requeued %d, %v", n, err)
	}
}

// The pass of the account jobs deletes archives older than a day, and the archive of a wiped
// account.
func TestAccountJobsExportFiles(t *testing.T) {
	app := newJobsApplication(t)
	expired := readyExport(t, app, 2, 25*time.Hour, "old")
	m := users(app)
	m.Schedule(time.Now().Add(-time.Hour), ago(25*time.Hour))
	m.ExportFile = readyExport(t, app, 1, time.Minute, "alice's")

	app.runAccountJobs(context.Background())
	if _, wiped := m.State(); !wiped {
		t.Fatal("not wiped")
	}
	for _, name := range []string{expired, m.ExportFile} {
		if exists(filepath.Join(app.ExportDir, name)) {
			t.Errorf("%s is still there", name)
		}
	}
	assert.Equal(t, exports(app).State(2), "")
}
