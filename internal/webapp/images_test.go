package webapp

import (
	"bytes"
	"encoding/binary"
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

// withSegment puts a JPEG segment of the marker right after SOI.
func withSegment(jpg []byte, marker byte, payload string) []byte {
	segment := []byte{0xFF, marker, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	segment = append(segment, payload...)
	return append(append([]byte{0xFF, 0xD8}, segment...), jpg[2:]...)
}

// withChunk appends a chunk to a WebP and fixes the RIFF size.
func withChunk(webp []byte, fourCC, payload string) []byte {
	chunk := append([]byte(fourCC), binary.LittleEndian.AppendUint32(nil, uint32(len(payload)))...)
	chunk = append(chunk, payload...)
	if len(payload)%2 == 1 {
		chunk = append(chunk, 0)
	}
	out := append(append([]byte{}, webp...), chunk...)
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(out)-8))
	return out
}

func TestCarriesMetadata(t *testing.T) {
	jpg := jpegOf(t, 192, 192)
	webp := webpOf(192, 192)
	for name, tt := range map[string]struct {
		mime string
		data []byte
		want bool
	}{
		"jpeg":                  {"image/jpeg", jpg, false},
		"jpeg with JFIF APP0":   {"image/jpeg", withSegment(jpg, 0xE0, "JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"), false},
		"jpeg with a comment":   {"image/jpeg", withSegment(jpg, 0xFE, "hello"), false},
		"jpeg with EXIF APP1":   {"image/jpeg", withSegment(jpg, 0xE1, "Exif\x00\x00II*\x00"), true},
		"jpeg with ICC APP2":    {"image/jpeg", withSegment(jpg, 0xE2, "ICC_PROFILE\x00"), true},
		"jpeg with APP15":       {"image/jpeg", withSegment(jpg, 0xEF, "x"), true},
		"jpeg cut short":        {"image/jpeg", jpg[:20], true},
		"jpeg segment too long": {"image/jpeg", append([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xFF}, jpg[2:]...), true},
		"jpeg no SOI":           {"image/jpeg", []byte{0xFF}, true},
		"webp":                  {"image/webp", webp, false},
		"webp with ICCP":        {"image/webp", withChunk(webp, "ICCP", "profile"), false},
		"webp with EXIF":        {"image/webp", withChunk(webp, "EXIF", "II*\x00"), true},
		"webp with XMP":         {"image/webp", withChunk(webp, "XMP ", "<x:xmpmeta/>"), true},
		"webp animated":         {"image/webp", withChunk(webp, "ANIM", "\x00\x00\x00\x00\x00\x00"), true},
		"webp chunk too long":   {"image/webp", append(append([]byte{}, webp...), "VP8 \xff\xff\x00\x00"...), true},
		"webp chunk header cut": {"image/webp", append(append([]byte{}, webp...), "VP8"...), true},
		"png":                   {"image/png", []byte("\x89PNG"), true},
	} {
		if got := carriesMetadata(tt.mime, tt.data); got != tt.want {
			t.Errorf("%s: %v, want %v", name, got, tt.want)
		}
	}
}
