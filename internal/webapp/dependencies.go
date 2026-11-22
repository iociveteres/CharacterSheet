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
	Debug bool
	// Dev is the -dev flag: it adds the routes e2e needs, such as /dev/account-jobs/run.
	Dev            bool
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
	Forum          ForumService
	// ExportDir is where the archives of the data exports are written (data_export.go);
	// ExportWorkers is how many are built at once, none in tests that start no workers.
	ExportDir     string
	ExportWorkers int
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
	// accountJobs lets one pass of the account jobs run at a time: the ticker's and the -dev
	// route's would send a reminder twice.
	accountJobs sync.Mutex
	// exportWake wakes an idle worker of the data exports when one is queued.
	exportWake chan struct{}
}

func NewApplication(deps *Dependencies) *Application {
	return &Application{Dependencies: deps, limits: newLimiters(), exportWake: make(chan struct{}, 1)}
}

// Wait blocks until background tasks started via app.background, the
// online-users updater, the limit sweeper and the account jobs have finished. cmd/web calls
// this during shutdown.
func (app *Application) Wait() {
	app.wg.Wait()
}
