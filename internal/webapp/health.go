package webapp

import (
	"context"
	"net/http"
	"time"
)

func (app *Application) health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func (app *Application) readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	// Try to ping the database
	if err := app.Models.CheckHealth(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Header().Set("Content-Type", "Application/json")
		w.Write([]byte(`{"status":"not_ready","database":"unavailable"}`))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "Application/json")
	w.Write([]byte(`{"status":"ready","database":"ok"}`))
}

func ping(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("OK"))
}
