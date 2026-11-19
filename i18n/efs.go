// Package i18n embeds the string catalog; internal/i18n loads it.
package i18n

import "embed"

//go:embed "catalog"
var Catalog embed.FS
