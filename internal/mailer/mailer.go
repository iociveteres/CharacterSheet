package mailer

import (
	"bytes"
	"context"
	"embed"
	"html/template"
	"io/fs"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/wneessen/go-mail"
)

//go:embed "templates"
var Templates embed.FS

type Mailer struct {
	client *mail.Client
	sender string
}

func New(host string, port int, username, password, sender string) (Mailer, error) {
	opts := []mail.Option{
		mail.WithSMTPAuth(mail.SMTPAuthAutoDiscover),
		mail.WithTLSPortPolicy(mail.TLSMandatory),
	}
	opts = append(opts, mail.WithPort(port))
	opts = append(opts, mail.WithUsername(username))
	opts = append(opts, mail.WithPassword(password))

	client, err := mail.NewClient(host, opts...)
	if err != nil {
		return Mailer{}, err
	}

	return Mailer{
		client: client,
		sender: sender,
	}, nil
}

// Check connects, upgrades to TLS and authenticates without sending anything: NewClient alone
// never touches the server, so wrong settings would otherwise surface only on the first email.
func (m Mailer) Check(ctx context.Context) error {
	client, err := m.client.DialToSMTPClientWithContext(ctx)
	if err != nil {
		return err
	}
	return m.client.CloseWithSMTPClient(client)
}

type Message struct {
	Subject   string
	PlainBody string
	HTMLBody  string
}

// Render executes templates/<name>.<lang>.html, or <name>.en.html when lang has no file.
func Render(lang, name string, data any) (Message, error) {
	file := "templates/" + name + "." + lang + ".html"
	if _, err := fs.Stat(Templates, file); err != nil {
		file = "templates/" + name + "." + i18n.Default + ".html"
	}
	tmpl, err := template.New("email").ParseFS(Templates, file)
	if err != nil {
		return Message{}, err
	}

	var msg Message
	for _, part := range []struct {
		name string
		dst  *string
	}{
		{"subject", &msg.Subject},
		{"plainBody", &msg.PlainBody},
		{"htmlBody", &msg.HTMLBody},
	} {
		buf := new(bytes.Buffer)
		if err := tmpl.ExecuteTemplate(buf, part.name, data); err != nil {
			return Message{}, err
		}
		*part.dst = buf.String()
	}
	return msg, nil
}

// Send renders the email name in lang (see Render) and sends it to recipient.
func (m Mailer) Send(recipient, lang, name string, data any) error {
	rendered, err := Render(lang, name, data)
	if err != nil {
		return err
	}

	msg := mail.NewMsg()
	msg.To(recipient)
	msg.From(m.sender)
	msg.Subject(rendered.Subject)
	msg.SetBodyString(mail.TypeTextPlain, rendered.PlainBody)
	msg.AddAlternativeString(mail.TypeTextHTML, rendered.HTMLBody)

	for i := 1; i <= 3; i++ {
		err = m.client.DialAndSend(msg)
		if nil == err {
			return nil
		}

		time.Sleep(3000 * time.Millisecond)
	}
	return err
}
