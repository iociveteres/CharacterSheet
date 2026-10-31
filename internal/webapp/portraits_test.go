package webapp

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// webpOf is the header of a lossless WebP of the size: all that
// image.DecodeConfig reads.
func webpOf(w, h int) []byte {
	payload := make([]byte, 5)
	payload[0] = 0x2f
	binary.LittleEndian.PutUint32(payload[1:], uint32(w-1)|uint32(h-1)<<14)
	chunk := append([]byte("VP8L"), binary.LittleEndian.AppendUint32(nil, uint32(len(payload)))...)
	chunk = append(append(chunk, payload...), 0) // a chunk of odd size is padded
	riff := append([]byte("RIFF"), binary.LittleEndian.AppendUint32(nil, uint32(4+len(chunk)))...)
	return append(append(riff, "WEBP"...), chunk...)
}

func TestPortraitRequests(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	portraits := app.Models.Portraits.(*mocks.PortraitModel)

	photo := jpegOf(t, 360, 480)
	code, _, _ := ts.send(t, http.MethodPut, "/sheet/portrait/1", "image/jpeg", bytes.NewReader(photo), token)
	assert.Equal(t, code, http.StatusNoContent)
	hash := portraits.Links[1]

	code, header, body := ts.get(t, "/portrait/"+hash)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, header.Get("Content-Type"), "image/jpeg")
	assert.Equal(t, header.Get("Cache-Control"), "private, max-age=31536000, immutable")
	assert.Equal(t, header.Get("X-Content-Type-Options"), "nosniff")
	assert.Equal(t, body, string(photo))

	// The type comes from the image, not from the request.
	code, _, _ = ts.send(t, http.MethodPut, "/sheet/portrait/3", "image/jpeg", bytes.NewReader(webpOf(360, 480)), token)
	assert.Equal(t, code, http.StatusNoContent)
	_, header, _ = ts.get(t, "/portrait/"+portraits.Links[3])
	assert.Equal(t, header.Get("Content-Type"), "image/webp")

	code, _, _ = ts.send(t, http.MethodDelete, "/sheet/portrait/1", "", nil, token)
	assert.Equal(t, code, http.StatusNoContent)
	if _, ok := portraits.Links[1]; ok {
		t.Error("the portrait outlived its delete")
	}
	code, _, _ = ts.get(t, "/portrait/"+hash)
	assert.Equal(t, code, http.StatusNotFound)
}

func TestPortraitIsChecked(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	var pngImage bytes.Buffer
	png.Encode(&pngImage, image.NewGray(image.Rect(0, 0, 360, 480)))
	for name, tt := range map[string]struct {
		path string
		body []byte
		want int
	}{
		"jpeg of another size": {"/sheet/portrait/1", jpegOf(t, 361, 480), http.StatusBadRequest},
		"webp of another size": {"/sheet/portrait/1", webpOf(480, 360), http.StatusBadRequest},
		"png":                  {"/sheet/portrait/1", pngImage.Bytes(), http.StatusBadRequest},
		"jpeg header only":     {"/sheet/portrait/1", []byte{0xFF, 0xD8, 0xFF, 0xE0}, http.StatusBadRequest},
		"empty":                {"/sheet/portrait/1", nil, http.StatusBadRequest},
		"too large":            {"/sheet/portrait/1", append(jpegOf(t, 360, 480), make([]byte, models.PortraitMaxBytes)...), http.StatusRequestEntityTooLarge},
		"a sheet user 1 views": {"/sheet/portrait/4", jpegOf(t, 360, 480), http.StatusForbidden},
		"a missing sheet":      {"/sheet/portrait/99", jpegOf(t, 360, 480), http.StatusNotFound},
		"no sheet id":          {"/sheet/portrait/x", jpegOf(t, 360, 480), http.StatusNotFound},
	} {
		code, _, _ := ts.send(t, http.MethodPut, tt.path, "image/jpeg", bytes.NewReader(tt.body), token)
		if code != tt.want {
			t.Errorf("%s: %d, want %d", name, code, tt.want)
		}
	}

	// noSurf rejects a change without the page's token.
	code, _, _ := ts.send(t, http.MethodPut, "/sheet/portrait/1", "image/jpeg", bytes.NewReader(jpegOf(t, 360, 480)), "")
	assert.Equal(t, code, http.StatusBadRequest)
	code, _, _ = ts.send(t, http.MethodDelete, "/sheet/portrait/4", "", nil, token)
	assert.Equal(t, code, http.StatusForbidden)

	for _, hash := range []string{"0123456789abcdef", "0123456789ABCDEF", "short", strings.Repeat("a", 64)} {
		code, _, _ := ts.get(t, "/portrait/"+hash)
		assert.Equal(t, code, http.StatusNotFound)
	}
}

func TestPortraitNeedsLogin(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, header, _ := ts.get(t, "/portrait/0123456789abcdef")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
}

// The sheet carries the hash of its portrait beside its content, and the
// pages that render sheets the token their portrait requests send.
func TestSheetCarriesPortrait(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)

	_, _, body := ts.get(t, "/sheet/view/1")
	assert.StringContains(t, body, `"portrait":null`)
	_, _, body = ts.get(t, "/bestiary")
	assert.StringContains(t, body, `<div id="bestiary" class="bestiary" data-csrf='`)
}
