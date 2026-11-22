package webapp

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"github.com/alehano/reverse"
)

// The export of a user's data: plan _prd/account_deletion, section 6. The page is plain HTML
// with forms, without a line of JS: while the archive is queued or being built, it reloads itself
// by <meta refresh>. The archive is built in the background (data_export_build.go) into a file
// of ExportDir, served only through the download route after the session is checked.

const (
	// exportLifetime is how long a ready archive is kept.
	exportLifetime = 24 * time.Hour
	// exportRefresh is how often, in seconds, the page reloads while the archive is on its way.
	exportRefresh = 5
	// exportDownloadTime bounds the download of an archive past the server's WriteTimeout.
	exportDownloadTime = 10 * time.Minute
)

// exportUser is the user whose data the request is about: the signed-in one, or the one in the
// grace period of a deletion (deletionPendingUserID), who may take their data too. Anyone else
// goes to the login page.
func (app *Application) exportUser(w http.ResponseWriter, r *http.Request) (int, bool) {
	w.Header().Add("Cache-Control", "no-store")
	if app.isAuthenticated(r) {
		return app.userID(r), true
	}
	if app.SessionManager.GetInt(r.Context(), deletionPendingKey) == 0 {
		app.redirectToLogin(w, r)
		return 0, false
	}
	userID, _, ok := app.pendingDeletion(w, r)
	return userID, ok
}

// currentExport is the user's export, nil for none. A ready one whose archive is gone (a
// restart empties /tmp) is forgotten: there is none, and nothing holds back a new one.
func (app *Application) currentExport(r *http.Request, userID int) (*models.DataExport, error) {
	e, err := app.Models.DataExports.Get(r.Context(), userID)
	if errors.Is(err, models.ErrNoRecord) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if e.State == models.ExportReady {
		if _, err := os.Stat(app.exportPath(e.FileName)); errors.Is(err, os.ErrNotExist) {
			return nil, app.Models.DataExports.Discard(r.Context(), userID, e.FileName)
		}
	}
	return e, nil
}

func (app *Application) accountExport(w http.ResponseWriter, r *http.Request) {
	userID, ok := app.exportUser(w, r)
	if !ok {
		return
	}
	e, err := app.currentExport(r, userID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	lang := i18n.FromContext(r.Context())
	page := &templates.ExportPage{}
	if e != nil {
		page.State = e.State
		page.Ahead = e.Ahead
		if e.State == models.ExportReady && e.ReadyAt != nil {
			page.Size = exportSize(lang, e.Size)
			page.AvailableUntil = e.ReadyAt.Add(exportLifetime)
			if next := e.RequestedAt.Add(models.ExportEvery); time.Now().Before(next) {
				page.NextAt = next
			}
		}
	}
	data := app.newTemplateData(r)
	data.Export = page
	data.Head = &templates.PageHead{Viewport: true}
	if page.State == models.ExportQueued || page.State == models.ExportBuilding {
		data.Head.Refresh = exportRefresh
	}
	app.render(w, http.StatusOK, "data_export.html", "base", data)
}

// accountExportPost queues an archive and wakes the workers. One asked for too soon (another
// tab) brings the page back, which tells when a new one may be built.
func (app *Application) accountExportPost(w http.ResponseWriter, r *http.Request) {
	userID, ok := app.exportUser(w, r)
	if !ok {
		return
	}
	// A ready export whose archive is gone is forgotten first, so that it does not count.
	if _, err := app.currentExport(r, userID); err != nil {
		app.serverError(w, err)
		return
	}
	old, err := app.Models.DataExports.Request(r.Context(), userID)
	var tooSoon *models.ExportTooSoonError
	if err != nil && !errors.As(err, &tooSoon) {
		app.serverError(w, err)
		return
	}
	if old != "" {
		app.removeExportFile(old)
	}
	if err == nil {
		app.wakeExports()
	}
	http.Redirect(w, r, reverse.Rev("AccountExport"), http.StatusSeeOther)
}

// accountExportDownload serves the user's ready archive. The session alone picks it: there is
// no way to ask for another user's.
func (app *Application) accountExportDownload(w http.ResponseWriter, r *http.Request) {
	userID, ok := app.exportUser(w, r)
	if !ok {
		return
	}
	e, err := app.currentExport(r, userID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	if e == nil || e.State != models.ExportReady {
		app.notFound(w)
		return
	}
	f, err := os.Open(app.exportPath(e.FileName))
	if errors.Is(err, os.ErrNotExist) {
		// Swept since currentExport looked.
		app.notFound(w)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	defer f.Close()
	// A few megabytes may take longer than the server's WriteTimeout on a slow line.
	if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(exportDownloadTime)); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("data export download: write deadline: %s", err))
	}
	w.Header().Set("Content-Type", "application/zip")
	setDownload(w, "charactersheet-data-"+e.ReadyAt.Format("2006-01-02")+".zip")
	http.ServeContent(w, r, "", *e.ReadyAt, f)
}

// exportPath is where the archive named name lies; the name comes from the database, Base keeps
// it inside ExportDir all the same.
func (app *Application) exportPath(name string) string {
	return filepath.Join(app.ExportDir, filepath.Base(name))
}

// removeExportFile deletes an archive; one already gone is no error.
func (app *Application) removeExportFile(name string) {
	if name == "" {
		return
	}
	if err := os.Remove(app.exportPath(name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		app.ErrorLog.Output(2, fmt.Sprintf("data export: remove %s: %s", name, err))
	}
}

// exportSize is the size of an archive as the page shows it, "2.4 MB" or "2,4 МБ".
// i18n-keys: site.account.export.sizeKB, site.account.export.sizeMB
func exportSize(lang string, bytes int64) string {
	key, value := "site.account.export.sizeKB", float64(bytes)/(1<<10)
	if bytes >= 1<<20 {
		key, value = "site.account.export.sizeMB", float64(bytes)/(1<<20)
	}
	s := strconv.FormatFloat(value, 'f', 1, 64)
	if lang == "ru" {
		s = strings.Replace(s, ".", ",", 1)
	}
	return i18n.T(lang, key, i18n.Params{"size": s})
}
