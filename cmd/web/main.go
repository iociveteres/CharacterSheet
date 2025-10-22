package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"html/template"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/go-playground/form/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
)

type application struct {
	debug          bool
	errorLog       *log.Logger
	infoLog        *log.Logger
	models         models.Models
	hubMap         map[int]*Hub
	templateCache  map[string]*template.Template
	formDecoder    *form.Decoder
	sessionManager *scs.SessionManager
	baseURL        string
	mailer         mailer.Mailer
	wg             sync.WaitGroup
}

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

	godotenv.Load()

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

	templateCache, err := newTemplateCache()
	if err != nil {
		errorLog.Fatal(err)
	}

	formDecoder := form.NewDecoder()

	sessionManager := scs.New()
	sessionManager.Store = pgxstore.New(pool)
	sessionManager.Lifetime = 12 * time.Hour
	sessionManager.Cookie.Secure = true

	mailer, err := mailer.New(cfg.smtp.host, cfg.smtp.port, cfg.smtp.username, cfg.smtp.password, cfg.smtp.sender)
	if err != nil {
		errorLog.Fatal(err)
	}

	app := &application{
		debug:          cfg.debug,
		errorLog:       errorLog,
		infoLog:        infoLog,
		models:         models.NewModels(pool),
		hubMap:         make(map[int]*Hub),
		templateCache:  templateCache,
		formDecoder:    formDecoder,
		sessionManager: sessionManager,
		baseURL:        os.Getenv("BASE_URL"),
		mailer:         mailer,
	}

	err = app.serve(cfg)
	if err != nil {
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

func (app *application) serve(cfg config) error {
	tlsConfig := &tls.Config{
		CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
	}

	srv := &http.Server{
		Addr:         cfg.addr,
		ErrorLog:     app.errorLog,
		Handler:      app.routes(),
		TLSConfig:    tlsConfig,
		IdleTimeout:  time.Minute,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	shutdownError := make(chan error)
	go func() {

		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		s := <-quit

		app.infoLog.Printf("shutting down server: %s", s.String())

		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		shutdownError <- srv.Shutdown(ctx)
	}()
	app.infoLog.Printf("Starting server on %s", cfg.addr)

	err := srv.ListenAndServeTLS("./tls/cert.pem", "./tls/key.pem")
	if !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	err = <-shutdownError
	if err != nil {
		return err
	}

	app.infoLog.Printf("Stopped server on %s", cfg.addr)

	return nil
}
