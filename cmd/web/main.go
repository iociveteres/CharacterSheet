package main

import (
	"context"
	"flag"
	"log"
	"os"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/roomws"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/webapp"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/go-playground/form/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
)

type config struct {
	addr  string
	debug bool
	env   string
	db    struct {
		dsn string
	}
	smtp struct {
		host     string
		port     int
		username string
		password string
		sender   string
	}
}

func main() {
	// logging
	infoLog := log.New(os.Stdout, "INFO\t", log.Ldate|log.Ltime)
	errorLog := log.New(os.Stderr, "ERROR\t", log.Ldate|log.Ltime|log.Lshortfile)

	env := os.Getenv("ENV")
	if env == "" || env == "development" {
		if err := godotenv.Load(); err != nil {
			infoLog.Println("Warning: .env file not found")
		}
	}

	var cfg config
	// command line flags parsing
	flag.StringVar(&cfg.addr, "addr", ":4000", "HTTP network address")

	flag.StringVar(&cfg.env, "env", "development", "Environment (development|staging|production)")

	flag.StringVar(&cfg.db.dsn, "dsn",
		os.Getenv("DATABASE_URL"),
		"Postgres data source name")

	flag.BoolVar(&cfg.debug, "debug", false, "Enable debug mode")

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

	// pool connection
	pool, err := openConnPool(cfg.db.dsn)
	if err != nil {
		errorLog.Fatal(err)
	}

	defer pool.Close()

	// JSON gamedata
	catalog, err := gamedata.Load()
	if err != nil {
		errorLog.Fatal(err)
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

	m := models.NewModels(pool)

	wsServer := roomws.NewServer(&roomws.Dependencies{
		Models:   m,
		Gamedata: catalog,
		InfoLog:  infoLog,
		ErrorLog: errorLog,
		BaseURL:  os.Getenv("BASE_URL"),
	})

	app := webapp.NewApplication(&webapp.Dependencies{
		Debug:          cfg.debug,
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
	})

	if err := serve(app, cfg); err != nil {
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
