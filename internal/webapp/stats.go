package webapp

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

func (app *Application) StartOnlineUsersUpdater(ctx context.Context) {
	app.onlineUsers.Store(int64(app.WSServer.TotalOnlineUsers()))

	app.wg.Add(1)
	go func() {
		defer app.wg.Done()

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				app.onlineUsers.Store(int64(app.WSServer.TotalOnlineUsers()))
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (app *Application) onlineUsersCount() int {
	return int(app.onlineUsers.Load())
}

func (app *Application) onlineUsersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "Application/json")
	w.Header().Set("Cache-Control", "public, max-age=2")
	fmt.Fprintf(w, `{"online":%d}`, app.onlineUsersCount())
}
