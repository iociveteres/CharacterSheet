package webapp

import (
	"bytes"
	"image"
	_ "image/jpeg"

	_ "golang.org/x/image/webp"
)

// croppedImageMime is the type of a WebP or JPEG image of exactly width ×
// height, read from its header; "" for anything else. The client's crop
// window (ui/static/js/crop) makes such an image at its geometry's output
// size: the sheet's portrait, the site's avatar.
func croppedImageMime(data []byte, width, height int) string {
	var mime string
	switch {
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		mime = "image/webp"
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		mime = "image/jpeg"
	default:
		return ""
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || "image/"+format != mime || config.Width != width || config.Height != height {
		return ""
	}
	return mime
}
