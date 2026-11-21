package forum

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// The parents a reader folded on the home are kept in a cookie as the density is: a guest has it
// too, each device its own, and the server renders the home folded from the first frame
// (_prd/forum/subsections, «Сворачивание»). The value is their ids joined by commas; no cookie,
// nothing folded.
const foldedCookie = "forum_folded"

// foldedFromRequest is the set of folded sections; what is not a positive number is skipped.
func foldedFromRequest(r *http.Request) map[int]bool {
	folded := map[int]bool{}
	c, err := r.Cookie(foldedCookie)
	if err != nil {
		return folded
	}
	for _, part := range strings.Split(c.Value, ",") {
		if id, err := strconv.Atoi(part); err == nil && id > 0 {
			folded[id] = true
		}
	}
	return folded
}

// setFold is the fold arrow of a parent on the home: it turns the section over in the cookie,
// leaving the others, and sends the browser back to the section's row. The forum script posts the
// same form in the background and toggles the rows itself. Ids of sections that no longer exist
// are dropped here, so the cookie does not grow with them.
func (f *Forum) setFold(w http.ResponseWriter, r *http.Request, v view) {
	id, err := strconv.Atoi(r.PostFormValue("section"))
	if err != nil || id < 1 {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	folded := foldedFromRequest(r)
	folded[id] = !folded[id]
	var ids []int
	for k, on := range folded {
		if on {
			ids = append(ids, k)
		}
	}
	rows, err := f.db.Query(r.Context(), `SELECT id FROM forum_sections WHERE id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	existing, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	kept := make([]string, len(existing))
	for i, k := range existing {
		kept[i] = strconv.Itoa(k)
	}
	c := densityCookieOf(strings.Join(kept, ","), 365*24*60*60)
	c.Name = foldedCookie
	if len(kept) == 0 {
		// Nothing folded is the default: no cookie.
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
	http.Redirect(w, r, "/forum/#section-"+strconv.Itoa(id), http.StatusSeeOther)
}
