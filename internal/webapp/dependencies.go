package webapp

import (
	"html/template"
	"log"
	"sync"
	"sync/atomic"

	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/roomws"
	"github.com/alexedwards/scs/v2"
	"github.com/go-playground/form/v4"
)

type Dependencies struct {
	Debug          bool
	ErrorLog       *log.Logger
	InfoLog        *log.Logger
	Models         models.Models
	TemplateCache  map[string]*template.Template
	FormDecoder    *form.Decoder
	SessionManager *scs.SessionManager
	WSServer       *roomws.Server
	BaseURL        string
	Gamedata       *gamedata.Catalog
	Mailer         mailer.Mailer
}

type Application struct {
	*Dependencies
	wg          sync.WaitGroup
	onlineUsers atomic.Int64
}

func NewApplication(deps *Dependencies) *Application {
	return &Application{Dependencies: deps}
}

// Wait blocks until background tasks started via app.background and the
// online-users updater have finished. cmd/web calls this during shutdown.
func (app *Application) Wait() {
	app.wg.Wait()
}