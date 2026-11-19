package forum

import (
	"net/http"
	"strconv"
)

const (
	topicsPerPage = 30
	postsPerPage  = 20
)

// pageParam reads ?page=N. Without it the page is 1; anything but a positive integer is an
// address that does not exist, as a page past the last one.
func pageParam(r *http.Request) (int, bool) {
	if !r.URL.Query().Has("page") {
		return 1, true
	}
	n, err := strconv.Atoi(r.URL.Query().Get("page"))
	return n, err == nil && n >= 1
}

// idParam reads the {id} of the address; false for anything but a positive integer.
func idParam(r *http.Request) (int, bool) {
	n, err := strconv.Atoi(r.PathValue("id"))
	return n, err == nil && n >= 1
}

// pageCount is never 0: an empty section or topic still has its first page.
func pageCount(items, perPage int) int {
	return max(1, (items+perPage-1)/perPage)
}

// pageURL is the address of page n of a list at path; the first page has no ?page, so it has
// one address only.
func pageURL(path string, n int) string {
	if n <= 1 {
		return path
	}
	return path + "?page=" + strconv.Itoa(n)
}

// pagination is the data of the "forum-pagination" template.
type pagination struct {
	Lang    string
	Path    string
	Current int
	Total   int
}

type pageLink struct {
	Number  int
	URL     string
	Current bool
	// Gap stands for the pages left out between two links.
	Gap bool
}

// Links are the first and the last page and two on each side of the current one, with gaps
// between them: a topic of a hundred pages does not list them all.
func (p pagination) Links() []pageLink {
	var links []pageLink
	for n := 1; n <= p.Total; n++ {
		if n != 1 && n != p.Total && (n < p.Current-2 || n > p.Current+2) {
			if !links[len(links)-1].Gap {
				links = append(links, pageLink{Gap: true})
			}
			continue
		}
		links = append(links, pageLink{Number: n, URL: pageURL(p.Path, n), Current: n == p.Current})
	}
	return links
}

func (p pagination) PrevURL() string {
	if p.Current <= 1 {
		return ""
	}
	return pageURL(p.Path, p.Current-1)
}

func (p pagination) NextURL() string {
	if p.Current >= p.Total {
		return ""
	}
	return pageURL(p.Path, p.Current+1)
}
