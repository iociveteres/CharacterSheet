package webapp

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
	"charactersheet.iociveteres.net/internal/util"
)

// putAvatar uploads `body` as the avatar and returns the status and the URL the server answers with.
func (ts *testServer) putAvatar(t *testing.T, body []byte, token string) (int, string) {
	t.Helper()
	code, _, resp := ts.send(t, http.MethodPut, "/account/avatar", "image/webp", bytes.NewReader(body), token)
	if code != http.StatusOK {
		return code, ""
	}
	var answer struct{ URL string }
	if err := json.Unmarshal([]byte(resp), &answer); err != nil {
		t.Fatal(err)
	}
	return code, answer.URL
}

func TestAvatarRequests(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	avatars := app.Models.Avatars.(*mocks.AvatarModel)

	photo := jpegOf(t, 192, 192)
	code, address := ts.putAvatar(t, photo, token)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, address, "/avatar/"+avatars.ByUser[1])

	code, header, body := ts.get(t, address)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, header.Get("Content-Type"), "image/jpeg")
	assert.Equal(t, header.Get("Cache-Control"), "public, max-age=31536000, immutable")
	assert.Equal(t, header.Get("X-Content-Type-Options"), "nosniff")
	assert.Equal(t, body, string(photo))

	// The type comes from the image, not from the request; a new image is a new address.
	code, second := ts.putAvatar(t, webpOf(192, 192), token)
	assert.Equal(t, code, http.StatusOK)
	if second == address {
		t.Error("a new avatar kept the address of the old one")
	}
	_, header, _ = ts.get(t, second)
	assert.Equal(t, header.Get("Content-Type"), "image/webp")

	// A delete takes only the signed-in user's avatar.
	if _, err := avatars.Put(context.Background(), 2, "image/jpeg", jpegOf(t, 192, 192)); err != nil {
		t.Fatal(err)
	}
	code, _, _ = ts.send(t, http.MethodDelete, "/account/avatar", "", nil, token)
	assert.Equal(t, code, http.StatusNoContent)
	if avatars.Of(1) != nil {
		t.Error("the avatar outlived its delete")
	}
	if avatars.Of(2) == nil {
		t.Error("a delete took another user's avatar")
	}
	code, _, _ = ts.get(t, second)
	assert.Equal(t, code, http.StatusNotFound)

	// Delete without the page's script: a form that comes back to the page.
	ts.putAvatar(t, photo, token)
	code, header, _ = ts.postForm(t, "/account/avatar/delete", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/view#avatar")
	if avatars.Of(1) != nil {
		t.Error("the avatar outlived the delete form")
	}
}

func TestAvatarIsChecked(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	avatars := app.Models.Avatars.(*mocks.AvatarModel)

	var pngImage bytes.Buffer
	png.Encode(&pngImage, image.NewGray(image.Rect(0, 0, 192, 192)))
	jpg := jpegOf(t, 192, 192)
	for name, tt := range map[string]struct {
		body []byte
		want int
	}{
		"jpeg of another size": {jpegOf(t, 192, 193), http.StatusBadRequest},
		"webp of another size": {webpOf(191, 192), http.StatusBadRequest},
		"the portrait's size":  {jpegOf(t, 360, 480), http.StatusBadRequest},
		"png":                  {pngImage.Bytes(), http.StatusBadRequest},
		"jpeg header only":     {[]byte{0xFF, 0xD8, 0xFF, 0xE0}, http.StatusBadRequest},
		"empty":                {nil, http.StatusBadRequest},
		"jpeg with EXIF":       {withSegment(jpg, 0xE1, "Exif\x00\x00II*\x00"), http.StatusBadRequest},
		"jpeg with APP15":      {withSegment(jpg, 0xEF, "x"), http.StatusBadRequest},
		"webp with EXIF":       {withChunk(webpOf(192, 192), "EXIF", "II*\x00"), http.StatusBadRequest},
		"webp with XMP":        {withChunk(webpOf(192, 192), "XMP ", "<x/>"), http.StatusBadRequest},
		"webp animated":        {withChunk(webpOf(192, 192), "ANIM", "\x00\x00\x00\x00\x00\x00"), http.StatusBadRequest},
		"too large":            {append(jpegOf(t, 192, 192), make([]byte, models.AvatarMaxBytes)...), http.StatusRequestEntityTooLarge},
	} {
		code, _ := ts.putAvatar(t, tt.body, token)
		if code != tt.want {
			t.Errorf("%s: %d, want %d", name, code, tt.want)
		}
	}
	if avatars.Of(1) != nil {
		t.Error("a refused image became the avatar")
	}

	// noSurf rejects a change without the page's token.
	code, _ := ts.putAvatar(t, jpg, "")
	assert.Equal(t, code, http.StatusBadRequest)
	code, _, _ = ts.send(t, http.MethodDelete, "/account/avatar", "", nil, "")
	assert.Equal(t, code, http.StatusBadRequest)
	code, _, _ = ts.postForm(t, "/account/avatar/delete", url.Values{})
	assert.Equal(t, code, http.StatusBadRequest)

	for _, hash := range []string{"0123456789abcdef", "0123456789ABCDEF", "short", strings.Repeat("a", 64)} {
		code, _, _ := ts.get(t, "/avatar/"+hash)
		assert.Equal(t, code, http.StatusNotFound)
	}
}

func TestAvatarLockRefusesUpload(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	avatars := app.Models.Avatars.(*mocks.AvatarModel)
	avatars.Remove(context.Background(), 1, &models.AvatarLock{Reason: "rule 3", ModeratorID: 2})

	code, _ := ts.putAvatar(t, jpegOf(t, 192, 192), token)
	assert.Equal(t, code, http.StatusForbidden)
	if avatars.Of(1) != nil {
		t.Error("an upload under a lock became the avatar")
	}

	// The page shows the lock in place of the frame.
	_, _, body := ts.get(t, "/account/view")
	assert.StringContains(t, body, `class="avatar-lock"`)
	// The letter on the user's tint, the one the forum gives them.
	assert.StringContains(t, body, `class="avatar-letter avatar-hue avatar-hue-`+strconv.Itoa(util.AvatarHue(1))+`"`)
}

// Anyone sees an avatar, guests too, and its request starts no session; changing one needs a login.
func TestAvatarIsPublic(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	avatars := app.Models.Avatars.(*mocks.AvatarModel)
	hash, err := avatars.Put(context.Background(), 2, "image/jpeg", jpegOf(t, 192, 192))
	if err != nil {
		t.Fatal(err)
	}

	code, header, _ := ts.get(t, "/avatar/"+hash)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, header.Get("Set-Cookie"), "")

	for _, req := range []struct{ method, path string }{
		{http.MethodPut, "/account/avatar"},
		{http.MethodDelete, "/account/avatar"},
		{http.MethodPost, "/account/avatar/delete"},
	} {
		// A token of the login page: without it noSurf would refuse before the login check.
		_, _, page := ts.get(t, "/user/login")
		code, header, _ := ts.send(t, req.method, req.path, "image/jpeg", bytes.NewReader(jpegOf(t, 192, 192)), extractCSRFToken(t, page))
		assert.Equal(t, code, http.StatusSeeOther)
		assert.Equal(t, header.Get("Location"), "/user/login")
	}
	if avatars.Of(2) == nil {
		t.Error("a guest's request took the avatar")
	}
}

// The Account page shows the saved avatar to the script and to a browser without it.
func TestAccountShowsAvatar(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	_, _, body := ts.get(t, "/account/view")
	assert.StringContains(t, body, `data-avatar=""`)
	_, address := ts.putAvatar(t, jpegOf(t, 192, 192), token)
	_, _, body = ts.get(t, "/account/view")
	assert.StringContains(t, body, `data-avatar="`+address+`"`)
	assert.StringContains(t, body, `<img src="`+address+`"`)
	assert.StringContains(t, body, `action="/account/avatar/delete"`)
}

// The Account page is laid out for phones and loads the avatar block's script and styles.
func TestAccountPageHead(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)

	_, _, body := ts.get(t, "/account/view")
	head, _, _ := strings.Cut(body, "</head>")
	assert.StringContains(t, head, `<meta name="viewport"`)
	assert.StringContains(t, head, `href='/static/css/crop.css?v=`)
	assert.StringContains(t, head, `href='/static/css/account.css?v=`)
	assert.StringContains(t, body, `src='/static/dist/account.js?v=`)

	_, _, body = ts.get(t, "/account/rooms")
	if strings.Contains(body, `name="viewport"`) || strings.Contains(body, "account.js") {
		t.Error("another site page got the Account page's head")
	}
}
