package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/roomws"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/webapp"
	"charactersheet.iociveteres.net/ui"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/go-playground/form/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
)

type config struct {
	addr     string
	debug    bool
	dev      bool
	env      string
	logLevel string
	rollSeed int64
	db       struct {
		dsn string
	}
	smtp struct {
		host     string
		port     int
		username string
		password string
		sender   string
	}
	export struct {
		dir     string
		workers int
	}
}

// Log levels, each with what the one before it writes: errors; events such as
// a sheet created, a request served; every message of the sockets and every
// edit of a sheet, with its content. The server's start and stop and the startup
// checks go out at every one, through lifeLog.
var logLevels = []string{"error", "info", "debug"}

// levelLog writes to `out` when `level` is at `at` or past it, else nowhere:
// a discarded log does not even format its message.
func levelLog(level, at string, out io.Writer, prefix string) *log.Logger {
	if slices.Index(logLevels, level) < slices.Index(logLevels, at) {
		out = io.Discard
	}
	return log.New(out, prefix, log.Ldate|log.Ltime)
}

func main() {
	errorLog := log.New(os.Stderr, "ERROR\t", log.Ldate|log.Ltime|log.Lshortfile)
	lifeLog := log.New(os.Stdout, "INFO\t", log.Ldate|log.Ltime)

	env := os.Getenv("ENV")
	envMissing := false
	if env == "" || env == "development" {
		envMissing = godotenv.Load() != nil
	}

	var cfg config
	// command line flags parsing
	flag.StringVar(&cfg.addr, "addr", ":4000", "HTTP network address")

	flag.StringVar(&cfg.env, "env", "development", "Environment (development|staging|production)")

	flag.StringVar(&cfg.db.dsn, "dsn",
		os.Getenv("DATABASE_URL"),
		"Postgres data source name")

	flag.BoolVar(&cfg.debug, "debug", false, "Enable debug mode")
	flag.BoolVar(&cfg.dev, "dev", false, "Serve /static from ./ui on disk (for npm run watch) and add the routes of e2e")
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "error"
	}
	flag.StringVar(&cfg.logLevel, "log-level", logLevel, "Log level (error|info|debug)")
	flag.Int64Var(&cfg.rollSeed, "roll-seed", 0, "Repeat the same rolls from run to run, seeded with this number (0: random rolls)")

	flag.StringVar(&cfg.export.dir, "export-dir", filepath.Join(os.TempDir(), "charactersheet-exports"), "Folder of the archives of the users' data exports")
	flag.IntVar(&cfg.export.workers, "export-workers", 2, "How many archives of data exports are built at once")

	port, err := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if err != nil {
		errorLog.Fatal(err)
	}
	flag.StringVar(&cfg.smtp.host, "smtp-host", os.Getenv("SMTP_HOSTNAME"), "SMTP host")
	flag.IntVar(&cfg.smtp.port, "smtp-port", port, "SMTP port")
	flag.StringVar(&cfg.smtp.username, "smtp-username", os.Getenv("SMTP_USER"), "SMTP username")
	flag.StringVar(&cfg.smtp.password, "smtp-password", os.Getenv("SMTP_PASS"), "SMTP password")
	flag.StringVar(&cfg.smtp.sender, "smtp-sender", "Charactersheet <no-reply@iociveteres.ru>", "SMTP sender")
	flag.Parse()

	if !slices.Contains(logLevels, cfg.logLevel) {
		errorLog.Fatalf("log level %q, want one of %v", cfg.logLevel, logLevels)
	}
	infoLog := levelLog(cfg.logLevel, "info", os.Stdout, "INFO\t")
	debugLog := levelLog(cfg.logLevel, "debug", os.Stdout, "DEBUG\t")
	if envMissing {
		infoLog.Println("Warning: .env file not found")
	}

	if cfg.rollSeed != 0 {
		commands.SeedRolls(cfg.rollSeed)
		infoLog.Printf("Rolls seeded with %d", cfg.rollSeed)
	}

	if cfg.dev {
		ui.EnableDevMode("ui")
		infoLog.Println("Dev mode: serving /static from ./ui on disk")
	}

	// pool connection
	pool, err := openConnPool(cfg.db.dsn)
	if err != nil {
		errorLog.Fatal(err)
	}

	defer pool.Close()

	// JSON gamedata
	catalog := gamedata.Load()
	for _, w := range catalog.Warnings() {
		errorLog.Printf("gamedata: %s", w)
	}

	templateCache, err := templates.NewTemplateCache()
	if err != nil {
		errorLog.Fatal(err)
	}

	formDecoder := form.NewDecoder()

	sessionManager := scs.New()
	sessionManager.Store = pgxstore.New(pool)
	sessionManager.Lifetime = 30 * 24 * time.Hour
	sessionManager.Cookie.Secure = true

	mailer, err := mailer.New(cfg.smtp.host, cfg.smtp.port, cfg.smtp.username, cfg.smtp.password, cfg.smtp.sender)
	if err != nil {
		errorLog.Fatal(err)
	}
	// In the background and only logged: a mail outage must not delay startup or fail the
	// deploy readiness check and roll back.
	go func() {
		if err := mailer.Check(context.Background()); err != nil {
			errorLog.Printf("smtp %s:%d unavailable, emails will not be sent: %s", cfg.smtp.host, cfg.smtp.port, err)
			return
		}
		lifeLog.Printf("smtp %s:%d ok", cfg.smtp.host, cfg.smtp.port)
	}()

	m := models.NewModels(pool)

	// A field edit goes at most every 200 ms per path (sheet/network.ts); a
	// drag or a batch makes short bursts. Under -dev the stress run and e2e
	// send faster than that.
	var messageLimit roomws.MessageLimit
	if !cfg.dev {
		messageLimit = roomws.MessageLimit{PerSecond: 20, Burst: 60}
	}

	var builds roomws.Builds
	if !cfg.dev {
		builds = roomws.Builds{Room: ui.Version("dist/room.js"), Bestiary: ui.Version("dist/bestiary.js")}
	}

	wsServer := roomws.NewServer(&roomws.Dependencies{
		Debug:        cfg.debug,
		Models:       m,
		Gamedata:     catalog,
		InfoLog:      infoLog,
		DebugLog:     debugLog,
		ErrorLog:     errorLog,
		BaseURL:      os.Getenv("BASE_URL"),
		MessageLimit: messageLimit,
		Builds:       builds,
	})

	app := webapp.NewApplication(&webapp.Dependencies{
		Debug:          cfg.debug,
		Dev:            cfg.dev,
		ErrorLog:       errorLog,
		InfoLog:        infoLog,
		Models:         m,
		TemplateCache:  templateCache,
		FormDecoder:    formDecoder,
		SessionManager: sessionManager,
		WSServer:       wsServer,
		BaseURL:        os.Getenv("BASE_URL"),
		Gamedata:       catalog,
		Mailer:         mailer,
		ExportDir:      cfg.export.dir,
		ExportWorkers:  cfg.export.workers,
	})
	app.Forum, err = forum.New(pool, os.Getenv("BASE_URL"), app.ForumHost())
	if err != nil {
		errorLog.Fatal(err)
	}

	if err := serve(app, cfg, lifeLog); err != nil {
		errorLog.Fatal(err)
	}
}

func openConnPool(dsn string) (*pgxpool.Pool, error) {
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(context.Background()); err != nil {
		return nil, err
	}
	return db, nil
}
