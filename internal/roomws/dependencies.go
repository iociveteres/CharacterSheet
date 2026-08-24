// internal/roomws/deps.go
package roomws

import (
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
	ErrorLog *log.Logger
	BaseURL  string
}

type Server struct {
	*Dependencies
	mu     sync.Mutex
	HubMap map[int]*Hub
}

func NewServer(deps *Dependencies) *Server {
	return &Server{
		Dependencies: deps,
		HubMap:       make(map[int]*Hub),
	}
}

func (server *Server) NewRoom(roomID int) *Hub {
	return &Hub{
		roomID:        roomID,
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

func (server *Server) TotalOnlineUsers() int {
	server.mu.Lock()
	defer server.mu.Unlock()

	total := 0
	for _, hub := range server.HubMap {
		total += hub.OnlineCount()
	}
	return total
}