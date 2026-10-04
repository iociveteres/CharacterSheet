package models

import (
	"encoding/json"
	"time"
)

// The bestiary as its clients see it: the /bestiary page and the "From
// bestiary" window of the room. tygo writes their TS types into
// ui/static/js/bestiary/types.gen.ts.

// BestiaryCollection is a collection of the user or a public one of another
// user.
type BestiaryCollection struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// Own is whether the collection is the user's; Owner is its owner's name.
	Own        bool                 `json:"own"`
	Owner      string               `json:"owner"`
	Visibility CollectionVisibility `json:"visibility" tstype:"'private' | 'public'"`
	// Default is the user's "My creatures": always private, never deleted.
	Default bool `json:"default"`
	// Subscribed is whether the user keeps another user's collection in their
	// list.
	Subscribed  bool       `json:"subscribed"`
	PublishedAt *time.Time `json:"publishedAt" tstype:"string | null,required"`
	Creatures   int        `json:"creatures"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// CatalogRow is a public collection in the catalog.
type CatalogRow struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Owner       string    `json:"owner"`
	Description string    `json:"description"`
	Own         bool      `json:"own"`
	Creatures   int       `json:"creatures"`
	PublishedAt time.Time `json:"publishedAt"`
}

// CatalogPage is a page of the catalog; Next is the cursor of the next page,
// null on the last.
type CatalogPage struct {
	Rows []CatalogRow `json:"rows"`
	Next *string      `json:"next" tstype:"string | null,required"`
}

// Creature is a row of the creature table: what it takes to pick one, not
// the sheet, which comes from /sheet/view/:id.
type Creature struct {
	ID           int       `json:"id"`
	CollectionID int       `json:"collectionId"`
	Name         string    `json:"name"`
	Kind         SheetKind `json:"kind" tstype:"SheetKind"`
	// SourceLabel is "collection · author" of another user's creature it was
	// copied from, as they were at the copy.
	SourceLabel *string `json:"sourceLabel" tstype:"string | null,required"`
	// Author is the name of the user who made the creature, or the one the
	// file it was uploaded from named; null once the author's account is
	// deleted.
	Author *string `json:"author" tstype:"string | null,required"`
	// ByYou is whether the user made it.
	ByYou     bool      `json:"byYou"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Quota is what the NPCs and creatures of the user take, in bytes.
type Quota struct {
	Used  int64 `json:"used"`
	Limit int64 `json:"limit"`
}

// Bestiary is what GET /bestiary/collections returns: all the page needs
// before a collection is picked.
type Bestiary struct {
	Collections []BestiaryCollection `json:"collections"`
	Quota       Quota                `json:"quota"`
}

// UploadResult is how one uploaded file went.
type UploadResult struct {
	File  string `json:"file"`
	Added int    `json:"added"`
	// Error is "invalid" or "quota"; empty when the file is in.
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

const (
	CollectionFileFormat  = "collection"
	CollectionFileVersion = 1
)

// CollectionFile is the file of an exported collection; uploading one adds
// its creatures to a collection.
type CollectionFile struct {
	Format      string           `json:"format"`
	Version     int              `json:"version"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Creatures   []CreatureInFile `json:"creatures"`
}

// CreatureInFile is a creature of a collection file; its content is as in
// the export of a sheet, without the kind inside.
type CreatureInFile struct {
	SheetKind SheetKind       `json:"sheetKind" tstype:"SheetKind"`
	Content   json.RawMessage `json:"content" tstype:"{ [key: string]: unknown }"`
	// Author is a name as text: the upload does not take it for a user.
	Author *string `json:"author"`
}
