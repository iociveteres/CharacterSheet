package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"charactersheet.iociveteres.net/internal/webapp"
)

func serve(app *webapp.Application, cfg config, lifeLog *log.Logger) error {
	tlsConfig := &tls.Config{
		CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
	}

	srv := &http.Server{
		Addr:         cfg.addr,
		ErrorLog:     app.ErrorLog,
		Handler:      app.Routes(),
		TLSConfig:    tlsConfig,
		IdleTimeout:  time.Minute,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	statsCtx, statsCancel := context.WithCancel(context.Background())
	app.StartOnlineUsersUpdater(statsCtx)

	shutdownError := make(chan error)
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		s := <-quit

		lifeLog.Printf("shutting down server: %s", s.String())
		statsCancel()

		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		shutdownError <- srv.Shutdown(ctx)
	}()

	lifeLog.Printf("Starting server on %s", cfg.addr)

	err := srv.ListenAndServe()
	if !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	if err := <-shutdownError; err != nil {
		return err
	}
	app.Wait()

	lifeLog.Printf("Stopped server on %s", cfg.addr)
	return nil
}
