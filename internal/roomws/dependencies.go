// internal/roomws/deps.go
package roomws

import (
	"io"
	"log"
	"sync"

	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/models"
	"golang.org/x/time/rate"
)

// MessageLimit holds back what one socket sends: PerSecond messages on
// average, Burst of them at once. The zero value lets everything through.
type MessageLimit struct {
	PerSecond rate.Limit
	Burst     int
}

// Builds are the hashes of the page bundles (ui.Version) a socket's first
// message names, so that a tab with an older bundle learns of a new one. An
// empty hash sends no hello.
type Builds struct {
	Room     string
	Bestiary string
}

type Dependencies struct {
	// Debug puts the stack trace of a server error into the reply, as
	// webapp.Dependencies.Debug does for a page.
	Debug    bool
	Models   models.Models
	Gamedata gamedata.Catalogs
	InfoLog  *log.Logger
	// DebugLog takes every message the sockets send and every edit of a
	// sheet; nil writes nowhere.
	DebugLog *log.Logger
	ErrorLog *log.Logger
	BaseURL  string
	// MessageLimit is off in tests and under -dev: the stress run and e2e
	// send faster than a player.
	MessageLimit MessageLimit
	// Builds is empty under -dev: the bundles change on disk under a running
	// server, and every reload would be a new version.
	Builds Builds
}

type Server struct {
	*Dependencies
	// mu guards the maps and the refs of their hubs.
	mu sync.Mutex
	// HubMap are the hubs of the rooms someone is in, by room.
	HubMap map[int]*Hub
	// BestiaryHubs are the hubs of the open /bestiary pages by user: the tabs
	// of one user share one.
	BestiaryHubs map[int]*Hub
}

func NewServer(deps *Dependencies) *Server {
	if deps.DebugLog == nil {
		deps.DebugLog = log.New(io.Discard, "", 0)
	}
	return &Server{
		Dependencies: deps,
		HubMap:       make(map[int]*Hub),
		BestiaryHubs: make(map[int]*Hub),
	}
}

func (server *Server) NewRoom(roomID int) *Hub {
	hub := server.newHub()
	hub.roomID = roomID
	hub.build = server.Builds.Room
	hub.handlers = server.buildWSHandlerMap()
	return hub
}

func (server *Server) newHub() *Hub {
	return &Hub{
		broadcast:     make(chan broadcastMessage, 256),
		direct:        make(chan directMessage, 256),
		userBroadcast: make(chan userBroadcastMessage, 256),
		register:      make(chan *Client, 16),
		unregister:    make(chan *Client, 16),
		kickUser:      make(chan int, 16),
		done:          make(chan struct{}),
		clients:       make(map[*Client]bool),
		infoLog:       server.InfoLog,
		errorLog:      server.ErrorLog,
	}
}

// acquireRoomHub is the hub of room roomID for a client that joins it,
// started if no one is in the room. The client gives it back with release.
func (server *Server) acquireRoomHub(roomID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()

	hub, ok := server.HubMap[roomID]
	if !ok {
		hub = server.NewRoom(roomID)
		server.HubMap[roomID] = hub
		go hub.Run()
	}
	hub.refs++
	return hub
}

// acquireBestiaryHub is the hub of the user's /bestiary tabs for one more
// of them, as acquireRoomHub.
func (server *Server) acquireBestiaryHub(userID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()

	hub, ok := server.BestiaryHubs[userID]
	if !ok {
		hub = server.newHub()
		hub.ownerID = userID
		hub.build = server.Builds.Bestiary
		hub.handlers = server.buildBestiaryHandlerMap()
		server.BestiaryHubs[userID] = hub
		go hub.Run()
	}
	hub.refs++
	return hub
}

// release gives back a hub a client acquired; the last one stops it. The
// count is checked and the hub taken out of its map under one lock, so that
// a client joining meanwhile starts a new hub rather than get a stopping one.
func (server *Server) release(hub *Hub) {
	server.mu.Lock()
	defer server.mu.Unlock()

	hub.refs--
	if hub.refs > 0 {
		return
	}
	if hub.ownerID != 0 {
		delete(server.BestiaryHubs, hub.ownerID)
	} else {
		delete(server.HubMap, hub.roomID)
	}
	close(hub.done)
}

// RoomHub is the hub of room roomID, nil when no one is in the room: then
// there is no one to tell of a change.
func (server *Server) RoomHub(roomID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()
	return server.HubMap[roomID]
}

// bestiaryHub is the hub of the user's /bestiary tabs, nil when none is
// open: then there is no one to tell of a change.
func (server *Server) bestiaryHub(userID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()
	return server.BestiaryHubs[userID]
}

// TotalOnlineUsers counts the open sockets, of the bestiary pages too.
func (server *Server) TotalOnlineUsers() int {
	server.mu.Lock()
	defer server.mu.Unlock()

	total := 0
	for _, hub := range server.HubMap {
		total += hub.OnlineCount()
	}
	for _, hub := range server.BestiaryHubs {
		total += hub.OnlineCount()
	}
	return total
}
