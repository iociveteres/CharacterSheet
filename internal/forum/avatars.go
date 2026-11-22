package forum

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/util"
)

// The avatar is the site's (extras/decisions.md, 2): the forum reads it through Host and never
// asks about a forum ban there, nor does the site ask the forum (decision 17).

// AvatarState is a user's avatar as their page shows it (block 6 of extras/plan.md).
type AvatarState struct {
	// URL is empty without an avatar.
	URL string
	// Lock is the standing lock on uploading one, nil without it.
	Lock *AvatarLock
}

// AvatarLock forbids a user to upload an avatar until Until, for good when it is nil.
type AvatarLock struct {
	UserID      int
	Until       *time.Time
	Reason      string
	ModeratorID int
	CreatedAt   time.Time
}

// avatarSize and replyAvatarSize are the CSS pixels of the <img>: a post's author column and the
// reply form. Smaller places (compact, a phone) shrink it in forum.css.
const (
	avatarSize      = 96
	replyAvatarSize = 40
)

// avatar is what the template "forum-avatar" draws: the image, or the first letter of the name
// when there is none (extras/decisions.md, 15) on the user's own tint (the class avatar-hue-N of
// main.css, as on the Account page).
type avatar struct {
	URL     string
	Initial string
	Hue     int
	Size    int
}

func newAvatar(url, name string, userID, size int) avatar {
	a := avatar{URL: url, Size: size}
	if url == "" {
		a.Hue = util.AvatarHue(userID)
		r, _ := utf8.DecodeRuneInString(strings.TrimSpace(name))
		if r != utf8.RuneError {
			a.Initial = strings.ToUpper(string(r))
		}
	}
	return a
}

// avatars asks the host for the avatars of these users in one call: a page makes one, whatever its
// number of authors. The page is worth more than the pictures: an error is logged and the page
// served with letters in their place.
func (f *Forum) avatars(r *http.Request, userIDs ...int) map[int]string {
	seen := make(map[int]bool, len(userIDs))
	ids := make([]int, 0, len(userIDs))
	for _, id := range userIDs {
		if id != 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	urls, err := f.host.Avatars(r.Context(), ids)
	if err != nil {
		f.host.LogError(r, err)
		return nil
	}
	return urls
}
