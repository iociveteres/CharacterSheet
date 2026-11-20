package webapp

import (
	"bytes"
	"image"
	"image/png"
	"testing"
)

func TestCroppedImageMime(t *testing.T) {
	pngOf := func(w, h int) []byte {
		var b bytes.Buffer
		if err := png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h))); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	// The outputs of the client's crop window: the sheet's portrait and the site's avatar.
	for _, size := range []struct{ w, h int }{{360, 480}, {192, 192}} {
		w, h := size.w, size.h
		for name, tt := range map[string]struct {
			data []byte
			want string
		}{
			"jpeg":                   {jpegOf(t, w, h), "image/jpeg"},
			"webp":                   {webpOf(w, h), "image/webp"},
			"jpeg a pixel wider":     {jpegOf(t, w+1, h), ""},
			"jpeg a pixel lower":     {jpegOf(t, w, h-1), ""},
			"webp turned":            {webpOf(h+1, w), ""},
			"png":                    {pngOf(w, h), ""},
			"jpeg header only":       {[]byte{0xFF, 0xD8, 0xFF, 0xE0}, ""},
			"webp header only":       {webpOf(w, h)[:12], ""},
			"webp signature on jpeg": {append([]byte("RIFF\x00\x00\x00\x00WEBP"), jpegOf(t, w, h)...), ""},
			"empty":                  {nil, ""},
		} {
			if got := croppedImageMime(tt.data, w, h); got != tt.want {
				t.Errorf("%d×%d, %s: %q, want %q", w, h, name, got, tt.want)
			}
		}
	}
	// Each size is only its own.
	if got := croppedImageMime(jpegOf(t, 192, 192), 360, 480); got != "" {
		t.Errorf("an avatar passed as a portrait: %q", got)
	}
	if got := croppedImageMime(webpOf(360, 480), 192, 192); got != "" {
		t.Errorf("a portrait passed as an avatar: %q", got)
	}
}
