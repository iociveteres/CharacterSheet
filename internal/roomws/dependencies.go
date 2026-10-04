// internal/roomws/deps.go
package roomws

import (
	"io"
	"log"
	"sync"

	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/models"
)

type Dependencies struct {
	debug    bool
	Models   models.Models
	Gamedata *gamedata.Catalog
	InfoLog  *log.Logger
	// DebugLog takes every message the sockets send and every edit of a
	// sheet; nil writes nowhere.
	DebugLog *log.Logger
	ErrorLog *log.Logger
	BaseURL  string
}

type Server struct {
	*Dependencies
	mu     sync.Mutex
	HubMap map[int]*Hub
	// BestiaryHubs are the hubs of the /bestiary pages by user: the tabs of
	// one user share one.
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
		clients:       make(map[*Client]bool),
		infoLog:       server.InfoLog,
		errorLog:      server.ErrorLog,
	}
}

func (server *Server) GetOrInitHub(roomID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()

	hub, ok := server.HubMap[roomID]
	if !ok {
		hub = server.NewRoom(roomID)
		server.HubMap[roomID] = hub
		go hub.Run()
	}
	return hub
}

func (server *Server) GetOrInitBestiaryHub(userID int) *Hub {
	server.mu.Lock()
	defer server.mu.Unlock()

	hub, ok := server.BestiaryHubs[userID]
	if !ok {
		hub = server.newHub()
		hub.ownerID = userID
		hub.handlers = server.buildBestiaryHandlerMap()
		server.BestiaryHubs[userID] = hub
		go hub.Run()
	}
	return hub
}

// bestiaryHub is the hub of the user's /bestiary tabs, nil when none was
// opened: then there is no one to tell of a change.
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
