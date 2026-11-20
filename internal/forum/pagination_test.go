package forum

import (
	"fmt"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestPaginationLinks(t *testing.T) {
	// The links as text: the current page in brackets, a gap as "…".
	show := func(p pagination) string {
		var parts []string
		for _, l := range p.Links() {
			switch {
			case l.Gap:
				parts = append(parts, "…")
			case l.Current:
				parts = append(parts, fmt.Sprintf("[%d]", l.Number))
			default:
				parts = append(parts, fmt.Sprint(l.Number))
			}
		}
		return strings.Join(parts, " ")
	}
	tests := []struct {
		current, total int
		want           string
	}{
		{1, 1, "[1]"},
		{1, 3, "[1] 2 3"},
		{1, 10, "[1] 2 3 … 10"},
		{4, 10, "1 2 3 [4] 5 6 … 10"},
		{5, 10, "1 … 3 4 [5] 6 7 … 10"},
		{10, 10, "1 … 8 9 [10]"},
	}
	for _, tt := range tests {
		p := pagination{Path: "/forum/topic/7", Current: tt.current, Total: tt.total}
		assert.Equal(t, show(p), tt.want)
	}

	p := pagination{Path: "/forum/topic/7", Current: 2, Total: 3}
	assert.Equal(t, p.PrevURL(), "/forum/topic/7")
	assert.Equal(t, p.NextURL(), "/forum/topic/7?page=3")
	assert.Equal(t, p.Links()[2].URL, "/forum/topic/7?page=3")
	assert.Equal(t, pagination{Current: 1, Total: 1}.PrevURL(), "")
	assert.Equal(t, pagination{Current: 1, Total: 1}.NextURL(), "")
}

func TestPageCount(t *testing.T) {
	for _, tt := range []struct{ items, want int }{{0, 1}, {1, 1}, {20, 1}, {21, 2}, {40, 2}, {41, 3}} {
		assert.Equal(t, pageCount(tt.items, postsPerPage), tt.want)
	}
}

func TestTopicRowPages(t *testing.T) {
	show := func(posts int) string {
		var parts []string
		for _, l := range (topicRow{Topic: Topic{ID: 7}, PostCount: posts}).Pages() {
			if l.Gap {
				parts = append(parts, "…")
			} else {
				parts = append(parts, fmt.Sprint(l.Number))
			}
		}
		return strings.Join(parts, " ")
	}
	tests := []struct {
		posts int
		want  string
	}{
		{1, ""},
		{postsPerPage, ""},
		{postsPerPage + 1, "1 2"},
		{4 * postsPerPage, "1 2 3 4"},
		{4*postsPerPage + 1, "1 … 4 5"},
		{7 * postsPerPage, "1 … 6 7"},
	}
	for _, tt := range tests {
		assert.Equal(t, show(tt.posts), tt.want)
	}
	pages := (topicRow{Topic: Topic{ID: 7}, PostCount: 3 * postsPerPage}).Pages()
	assert.Equal(t, pages[0].URL, "/forum/topic/7")
	assert.Equal(t, pages[2].URL, "/forum/topic/7?page=3")
}
