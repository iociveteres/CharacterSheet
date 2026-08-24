package main

import (
	"context"
	"time"
)

func (app *application) startOnlineUsersUpdater(ctx context.Context) {
	app.onlineUsers.Store(int64(app.wsServer.TotalOnlineUsers()))

	app.wg.Add(1)
	go func() {
		defer app.wg.Done()

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				app.onlineUsers.Store(int64(app.wsServer.TotalOnlineUsers()))
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (app *application) onlineUsersCount() int {
	return int(app.onlineUsers.Load())
}
