package webapp

import (
	"html/template"
	"log"
	"sync"
	"sync/atomic"

	"charactersheet.iociveteres.net/internal/gamedata"
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
	TemplateCache  map[string]map[string]*template.Template
	FormDecoder    *form.Decoder
	SessionManager *scs.SessionManager
	WSServer       *roomws.Server
	BaseURL        string
	Gamedata       gamedata.Catalogs
	Mailer         MailSender
}

// MailSender is mailer.Mailer; tests put a fake in its place.
type MailSender interface {
	// Send sends the email templates/<name>.<lang>.html of internal/mailer.
	Send(recipient, lang, name string, data any) error
}

type Application struct {
	*Dependencies
	wg          sync.WaitGroup
	onlineUsers atomic.Int64
	limits      *limiters
}

func NewApplication(deps *Dependencies) *Application {
	return &Application{Dependencies: deps, limits: newLimiters()}
}

// Wait blocks until background tasks started via app.background, the
// online-users updater and the limit sweeper have finished. cmd/web calls
// this during shutdown.
func (app *Application) Wait() {
	app.wg.Wait()
}