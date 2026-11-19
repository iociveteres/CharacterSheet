package forum

import (
	"net/http"

	"charactersheet.iociveteres.net/internal/i18n"
)

func (f *Forum) home(w http.ResponseWriter, r *http.Request) {
	data := f.view(r)
	f.render(w, r, http.StatusOK, "home.html", data, Page{
		Title:       i18n.T(data.Lang, "forum.sections.title"),
		Description: i18n.T(data.Lang, "forum.sections.description"),
		Canonical:   f.baseURL + "/forum/",
	})
}
