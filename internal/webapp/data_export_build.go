package webapp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
)

// The workers that build the archives of the data exports (plan _prd/account_deletion, sections
// 6.2 and 6.3). The archive is written while the data is read, straight into its file: the server
// has 1 GB, and nothing of an archive is held whole.

// exportPoll is how often an idle worker looks at the queue without being woken: a wake-up
// lost to a full channel, or a row queued again at the start, waits no longer than that.
const exportPoll = time.Minute

// exportPart is the suffix of an archive being written; what is left of one when the server
// died is deleted at the next start.
const exportPart = ".part"

// wakeExports tells an idle worker that an export is queued.
func (app *Application) wakeExports() {
	select {
	case app.exportWake <- struct{}{}:
	default:
	}
}

// startExportWorkers starts ExportWorkers workers on the queue, until ctx is done. What a
// previous run left half built is queued again and its files deleted.
func (app *Application) startExportWorkers(ctx context.Context) {
	if app.ExportWorkers < 1 {
		return
	}
	if err := os.MkdirAll(app.ExportDir, 0o700); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("data export: folder %s: %s", app.ExportDir, err))
	}
	parts, _ := filepath.Glob(filepath.Join(app.ExportDir, "*"+exportPart))
	for _, p := range parts {
		os.Remove(p)
	}
	if n, err := app.Models.DataExports.RequeueBuilding(ctx); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("data export: requeue: %s", err))
	} else if n > 0 {
		app.InfoLog.Printf("data export: %d exports queued again", n)
	}
	for range app.ExportWorkers {
		app.wg.Add(1)
		go func() {
			defer app.wg.Done()
			app.exportWorker(ctx)
		}()
	}
}

// exportWorker builds the queued exports one after another, then waits to be woken.
func (app *Application) exportWorker(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-app.exportWake:
		case <-timer.C:
		}
		for ctx.Err() == nil {
			userID, err := app.Models.DataExports.Claim(ctx)
			if errors.Is(err, models.ErrNoRecord) || ctx.Err() != nil {
				break
			}
			if err != nil {
				app.ErrorLog.Output(2, fmt.Sprintf("data export: claim: %s", err))
				break
			}
			// One wake-up for several exports: pass it on to the next idle worker.
			app.wakeExports()
			app.buildExport(ctx, userID)
		}
		timer.Reset(exportPoll)
	}
}

// buildExport writes the user's archive and marks the export ready, or failed. Cut short by the
// server's stop, it deletes what it wrote and queues the export again.
func (app *Application) buildExport(ctx context.Context, userID int) {
	// The bookkeeping after the build goes on when ctx is done: the export must not stay building.
	after, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	f, err := os.CreateTemp(app.ExportDir, "export-*.zip"+exportPart)
	if err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("data export: user %d: %s", userID, err))
		app.failExport(after, userID)
		return
	}
	err = app.writeArchiveSafely(ctx, f, userID)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	part := f.Name()
	if err != nil {
		os.Remove(part)
		if ctx.Err() != nil {
			if err := app.Models.DataExports.Requeue(after, userID); err != nil {
				app.ErrorLog.Output(2, fmt.Sprintf("data export: requeue user %d: %s", userID, err))
			}
			return
		}
		app.ErrorLog.Output(2, fmt.Sprintf("data export: user %d: %s", userID, err))
		app.failExport(after, userID)
		return
	}
	name := strings.TrimSuffix(filepath.Base(part), exportPart)
	if err := os.Rename(part, app.exportPath(name)); err != nil {
		os.Remove(part)
		app.ErrorLog.Output(2, fmt.Sprintf("data export: user %d: %s", userID, err))
		app.failExport(after, userID)
		return
	}
	info, err := os.Stat(app.exportPath(name))
	if err != nil {
		app.removeExportFile(name)
		app.ErrorLog.Output(2, fmt.Sprintf("data export: user %d: %s", userID, err))
		app.failExport(after, userID)
		return
	}
	err = app.Models.DataExports.Finish(after, userID, name, info.Size())
	if err != nil {
		// ErrNoRecord: the account was wiped meanwhile, its row is gone with the archive's name.
		app.removeExportFile(name)
		if !errors.Is(err, models.ErrNoRecord) {
			app.ErrorLog.Output(2, fmt.Sprintf("data export: finish user %d: %s", userID, err))
			app.failExport(after, userID)
		}
	}
}

func (app *Application) failExport(ctx context.Context, userID int) {
	if err := app.Models.DataExports.Fail(ctx, userID); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("data export: fail user %d: %s", userID, err))
	}
}

// writeArchiveSafely is writeArchive with a panic turned into an error: one user's archive must
// not stop the worker.
func (app *Application) writeArchiveSafely(ctx context.Context, w io.Writer, userID int) (err error) {
	defer func() {
		if v := recover(); v != nil {
			err = fmt.Errorf("panic: %v", v)
		}
	}()
	return app.writeArchive(ctx, w, userID, time.Now())
}

// exportReadme lists the files of the archive in the order README.txt names them.
// i18n-keys: site.account.export.readme.*
var exportReadme = []struct{ file, key string }{
	{"account.json", "site.account.export.readme.account"},
	{"avatar.webp | avatar.jpg", "site.account.export.readme.avatar"},
	{"rooms.json", "site.account.export.readme.rooms"},
	{"sheets/", "site.account.export.readme.sheets"},
	{"npcs/", "site.account.export.readme.npcs"},
	{"bestiary/", "site.account.export.readme.bestiary"},
	{"portraits/", "site.account.export.readme.portraits"},
	{"chat.json", "site.account.export.readme.chat"},
	{"forum/topics.json", "site.account.export.readme.forumTopics"},
	{"forum/posts.json", "site.account.export.readme.forumPosts"},
	{"forum/profile.json", "site.account.export.readme.forumProfile"},
	{"moderation.json", "site.account.export.readme.moderation"},
}

// writeArchive writes the ZIP of the user's data (plan, section 6.3) to w. A sheet goes in the
// format of /sheet/export and a collection in that of its export, so that either can be loaded
// back. The scenes stay out (decision 24), so does the moderation log (decision 15).
func (app *Application) writeArchive(ctx context.Context, w io.Writer, userID int, now time.Time) error {
	data := app.Models.DataExports
	account, err := data.Account(ctx, userID)
	if err != nil {
		return err
	}
	lang := jobMailLanguage(account.Locale)
	z := &archive{zip: zip.NewWriter(w), now: now}

	if err := z.json("account.json", struct {
		*models.ExportAccount
		ExportedAt time.Time `json:"exportedAt"`
	}{account, now}); err != nil {
		return err
	}

	avatar, err := data.Avatar(ctx, userID)
	if err != nil && !errors.Is(err, models.ErrNoRecord) {
		return err
	}
	if avatar != nil {
		if err := z.file("avatar"+imageExt(avatar.Mime), avatar.Data); err != nil {
			return err
		}
	}

	rooms, err := data.Rooms(ctx, userID)
	if err != nil {
		return err
	}
	if err := z.json("rooms.json", rooms); err != nil {
		return err
	}

	err = data.Sheets(ctx, userID, func(s models.ExportSheet) error {
		file, err := sheetFile(s.Content, s.Kind, s.Author)
		if err != nil {
			return err
		}
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, file, "", "  "); err != nil {
			return err
		}
		folder := "sheets"
		if s.NPC {
			folder = "npcs"
		}
		return z.file(folder+"/"+pathName(s.Room)+"/"+pathName(s.CharacterName)+"-"+strconv.Itoa(s.ID)+".json", pretty.Bytes())
	})
	if err != nil {
		return err
	}

	collections, err := data.Collections(ctx, userID)
	if err != nil {
		return err
	}
	for _, c := range collections {
		// One collection at a time: they are bounded by the quota (models.QuotaBytes).
		f, err := app.Models.Bestiary.Export(ctx, userID, c.ID)
		if err != nil {
			return err
		}
		if err := z.json("bestiary/"+pathName(c.Name)+"-"+strconv.Itoa(c.ID)+".json", f); err != nil {
			return err
		}
	}

	hashes, err := data.PortraitHashes(ctx, userID)
	if err != nil {
		return err
	}
	for _, hash := range hashes {
		p, err := data.Portrait(ctx, hash)
		if errors.Is(err, models.ErrNoRecord) {
			continue
		}
		if err != nil {
			return err
		}
		if err := z.file("portraits/"+pathName(hash)+imageExt(p.Mime), p.Data); err != nil {
			return err
		}
	}

	if err := z.jsonArray("chat.json", func(add func(any) error) error {
		return data.ChatMessages(ctx, userID, func(m models.ExportMessage) error { return add(m) })
	}); err != nil {
		return err
	}
	if err := z.jsonArray("forum/topics.json", func(add func(any) error) error {
		return data.ForumTopics(ctx, userID, func(t forum.ExportTopic) error { return add(t) })
	}); err != nil {
		return err
	}
	if err := z.jsonArray("forum/posts.json", func(add func(any) error) error {
		return data.ForumPosts(ctx, userID, func(p forum.ExportPost) error { return add(p) })
	}); err != nil {
		return err
	}
	profile, err := data.ForumProfile(ctx, userID)
	if err != nil {
		return err
	}
	if err := z.json("forum/profile.json", profile); err != nil {
		return err
	}
	moderation, err := data.Moderation(ctx, userID)
	if err != nil {
		return err
	}
	if err := z.json("moderation.json", moderation); err != nil {
		return err
	}

	var readme strings.Builder
	readme.WriteString(i18n.T(lang, "site.account.export.readme.intro", i18n.Params{"name": account.Name, "date": i18n.FormatDate(lang, now, nil) + " UTC"}))
	readme.WriteString("\r\n\r\n")
	for _, f := range exportReadme {
		readme.WriteString(f.file + " — " + i18n.T(lang, f.key) + "\r\n")
	}
	readme.WriteString("\r\n" + i18n.T(lang, "site.account.export.readme.reimport") + "\r\n")
	if err := z.file("README.txt", []byte(readme.String())); err != nil {
		return err
	}
	return z.zip.Close()
}

// archive writes the files of a ZIP one after another.
type archive struct {
	zip *zip.Writer
	now time.Time
}

func (a *archive) create(name string) (io.Writer, error) {
	return a.zip.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: a.now})
}

func (a *archive) file(name string, data []byte) error {
	w, err := a.create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func (a *archive) json(name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return a.file(name, append(b, '\n'))
}

// jsonArray writes a JSON array whose elements read gives to add one by one, as they come from
// the database.
func (a *archive) jsonArray(name string, read func(add func(any) error) error) error {
	w, err := a.create(name)
	if err != nil {
		return err
	}
	n := 0
	err = read(func(v any) error {
		b, err := json.MarshalIndent(v, "  ", "  ")
		if err != nil {
			return err
		}
		sep := ",\n  "
		if n == 0 {
			sep = "[\n  "
		}
		n++
		if _, err := io.WriteString(w, sep); err != nil {
			return err
		}
		_, err = w.Write(b)
		return err
	})
	if err != nil {
		return err
	}
	end := "\n]\n"
	if n == 0 {
		end = "[]\n"
	}
	_, err = io.WriteString(w, end)
	return err
}

func imageExt(mime string) string {
	if mime == "image/jpeg" {
		return ".jpg"
	}
	return ".webp"
}

// pathName makes a name typed by a user (a room, a character, a collection) a safe segment of
// a path in the archive: no separators, nothing Windows refuses, not too long.
func pathName(name string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		switch {
		case r == utf8.RuneError || unicode.IsControl(r) || strings.ContainsRune(`/\:*?"<>|`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	s := []rune(b.String())
	if len(s) > 60 {
		s = s[:60]
	}
	out := strings.Trim(strings.TrimSpace(string(s)), ".")
	if out == "" {
		return "_"
	}
	return out
}
