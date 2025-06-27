package main

import (
	"context"
	"database/sql"
	"flag"
	"html/template"
	"log"
	"net/http"
	"os"

	"charactersheet.iociveteres.net/internal/models"

	"github.com/go-playground/form/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type application struct {
	errorLog       *log.Logger
	infoLog        *log.Logger
	sheets         *models.SheetModel
	templateCache  map[string]*template.Template
	formDecoder    *form.Decoder
}

func main() {
	// command line flags parsing
	addr := flag.String("addr", ":4000", "HTTP network address")
	dsn := flag.String("dsn",
		"postgres://web:pass@localhost:5432/charactersheet?sslmode=disable&timezone=UTC",
		"Postgres data source name")
	flag.Parse()

	// logging
	infoLog := log.New(os.Stdout, "INFO\t", log.Ldate|log.Ltime)
	errorLog := log.New(os.Stderr, "ERROR\t", log.Ldate|log.Ltime|log.Lshortfile)

	// pool connection
	pool, err := pgxpool.New(context.Background(), *dsn)
	if err != nil {
		errorLog.Fatal(err)
	}

	defer pool.Close()

	templateCache, err := newTemplateCache()
	if err != nil {
		errorLog.Fatal(err)
	}

	formDecoder := form.NewDecoder()

	app := &application{
		errorLog:      errorLog,
		infoLog:       infoLog,
		sheets:        &models.SheetModel{DB: pool},
		templateCache: templateCache,
		formDecoder:   formDecoder,
	}

	srv := &http.Server{
		Addr:     *addr,
		ErrorLog: errorLog,
		Handler:  app.routes(),
	}

	infoLog.Printf("Starting server on %s", *addr)
	err = srv.ListenAndServe()
	errorLog.Fatal(err)
}

func openDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}
