package webapp

import (
	"bytes"
	"encoding/binary"
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

// carriesMetadata tells whether a WebP has an EXIF, XMP or animation chunk or
// a JPEG an APP1–APP15 segment (EXIF, XMP, ICC and the like), which may hold
// where and with what a photo was taken; also true for a file whose chunks or
// segments do not add up. A canvas never writes them, but a request can be
// made by hand, and a public image must not carry them.
func carriesMetadata(mime string, data []byte) bool {
	switch mime {
	case "image/webp":
		return webpCarriesMetadata(data)
	case "image/jpeg":
		return jpegCarriesMetadata(data)
	}
	return true
}

func webpCarriesMetadata(data []byte) bool {
	// RIFF, the file's size, WEBP, then chunks: a FourCC, a little-endian
	// size and the payload, padded to an even length.
	if len(data) < 12 {
		return true
	}
	for rest := data[12:]; len(rest) > 0; {
		if len(rest) < 8 {
			return true
		}
		switch string(rest[:4]) {
		case "EXIF", "XMP ", "ANIM", "ANMF":
			return true
		}
		size := uint64(binary.LittleEndian.Uint32(rest[4:8]))
		if size > uint64(len(rest)-8) {
			return true
		}
		rest = rest[8+size:]
		// Skip the padding byte, which the last chunk may lack.
		if size%2 == 1 && len(rest) > 0 {
			rest = rest[1:]
		}
	}
	return false
}

func jpegCarriesMetadata(data []byte) bool {
	// SOI, then segments: 0xFF, a marker and, but for the standalone ones,
	// a big-endian length that counts itself. The image data after SOS has no
	// segments to read.
	if len(data) < 2 {
		return true
	}
	for i := 2; ; {
		if i+2 > len(data) || data[i] != 0xFF {
			return true
		}
		marker := data[i+1]
		switch {
		case marker == 0xFF: // fill byte
			i++
			continue
		case marker == 0x01 || marker >= 0xD0 && marker <= 0xD7:
			i += 2
			continue
		case marker == 0xD9: // EOI before any image data
			return true
		case marker >= 0xE1 && marker <= 0xEF:
			return true
		case marker == 0xDA:
			return false
		}
		if i+4 > len(data) {
			return true
		}
		length := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if length < 2 {
			return true
		}
		i += 2 + length
	}
}
