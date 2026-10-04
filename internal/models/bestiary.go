package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The bestiary of a user: collections of creatures, sheets the gamemaster
// builds NPCs from (_prd/gm_mode/data-model.md). The user changes only their
// own collections; those of others they read while they are public.
type BestiaryModelInterface interface {
	// Get lists the user's collections and the public ones they subscribed to.
	Get(ctx context.Context, userID int) (*Bestiary, error)
	Catalog(ctx context.Context, userID int, filter CatalogFilter) (*CatalogPage, error)
	CreateCollection(ctx context.Context, userID int, name string) (*BestiaryCollection, error)
	UpdateCollection(ctx context.Context, userID, collectionID int, edit CollectionEdit) (*BestiaryCollection, error)
	// DeleteCollection deletes the collection with its creatures and returns their ids.
	DeleteCollection(ctx context.Context, userID, collectionID int) ([]int, error)
	// Collection is a collection the user can view: theirs or a public one.
	Collection(ctx context.Context, userID, collectionID int) (*BestiaryCollection, error)
	// Subscribe puts another user's public collection in the user's list.
	Subscribe(ctx context.Context, userID, collectionID int) (*BestiaryCollection, error)
	Unsubscribe(ctx context.Context, userID, collectionID int) error
	Export(ctx context.Context, userID, collectionID int) (*CollectionFile, error)
	// Upload adds the creatures to the collection, all or none of them.
	Upload(ctx context.Context, userID, collectionID int, creatures []CreatureInFile) (int, error)

	Creatures(ctx context.Context, userID int, filter CreatureFilter) ([]Creature, error)
	// NewCreature adds an empty sheet of the kind to the user's collection.
	NewCreature(ctx context.Context, userID, collectionID int, kind SheetKind) (*Creature, error)
	UpdateCreature(ctx context.Context, userID, creatureID int, edit CreatureEdit) (*Creature, error)
	// CopyCreature copies a creature the user can view into their collection.
	CopyCreature(ctx context.Context, userID, creatureID int, target CollectionTarget) (*Creature, error)
	MoveCreature(ctx context.Context, userID, creatureID, collectionID int) (*Creature, error)
	DeleteCreature(ctx context.Context, userID, creatureID int) error

	// Save copies a sheet the user can view, a character or an NPC, into the
	// user's collection.
	Save(ctx context.Context, userID, sheetID int, target CollectionTarget) (*Creature, error)
	// AddVariant copies an NPC into the collection of its creature as a new
	// creature named `name`, which becomes the NPC's source; it returns the
	// creature and the NPC's encounter.
	AddVariant(ctx context.Context, userID, sheetID int, name string) (*Creature, int, error)
}

// ErrInvalidBestiaryRequest is a request the bestiary cannot take: an empty
// or too long name, too many tags, a file that is no sheet, a public or
// deleted default collection, a subscription to the user's own collection.
var ErrInvalidBestiaryRequest = errors.New("models: invalid bestiary request")

const (
	maxCollectionName  = 100
	maxDescription     = 2000
	maxCreatureName    = 200
	maxTag             = 40
	maxTags            = 20
	maxTagSuggestions  = 10 // of the user's own, and as many of the public ones
	catalogPage        = 50
	creatureNamePath   = "{characterInfo,characterName}"
	lastInitiativePath = "{initiative,lastInitiative}"
)

const (
	// The collection every user has; migration 000037 names it too.
	defaultCollectionName = "My creatures"
	newCreatureName       = "New creature"
)

type BestiaryModel struct {
	DB *pgxpool.Pool
}

type CollectionVisibility string

const (
	VisibilityPrivate CollectionVisibility = "private"
	VisibilityPublic  CollectionVisibility = "public"
)

func (v CollectionVisibility) IsValid() bool {
	return v == VisibilityPrivate || v == VisibilityPublic
}

// CollectionEdit changes the fields that are set.
type CollectionEdit struct {
	Name        *string               `json:"name"`
	Description *string               `json:"description"`
	Tags        *[]string             `json:"tags"`
	Visibility  *CollectionVisibility `json:"visibility"`
}

// CatalogFilter narrows the public collections: to names with Query in them,
// to those with Tag. Oldest turns the order: the first published first. After
// is the next page's cursor of the page before, nil for the first page.
type CatalogFilter struct {
	Query  string
	Tag    string
	Oldest bool
	After  *CatalogCursor
}

// CatalogCursor is the last row of a catalog page. The next page starts after
// it, not at an offset: a collection published in between does not repeat a
// row.
type CatalogCursor struct {
	PublishedAt time.Time
	ID          int
}

func (c CatalogCursor) String() string {
	return fmt.Sprintf("%d-%d", c.PublishedAt.UnixMicro(), c.ID)
}

// ParseCatalogCursor reads CatalogCursor.String.
func ParseCatalogCursor(s string) (*CatalogCursor, error) {
	var micro int64
	var id int
	if _, err := fmt.Sscanf(s, "%d-%d", &micro, &id); err != nil || id < 1 {
		return nil, ErrInvalidBestiaryRequest
	}
	return &CatalogCursor{PublishedAt: time.UnixMicro(micro), ID: id}, nil
}

// CollectionTarget is where a copy goes: the user's collection CollectionID,
// or, with NewCollection, a collection of theirs made with the copy.
type CollectionTarget struct {
	CollectionID  int    `json:"collectionId"`
	NewCollection string `json:"newCollection"`
}

// CreatureEdit changes the fields that are set.
type CreatureEdit struct {
	Name *string   `json:"name"`
	Tags *[]string `json:"tags"`
}

// CreatureFilter narrows the creatures of the user: to a collection, to names
// with Query in them, to those with Tag.
type CreatureFilter struct {
	CollectionID *int
	Query        string
	Tag          string
}

// cleanTags trims the tags and drops empty ones and repeats, which differ
// only in case; too long a tag or too many fail.
func cleanTags(tags []string) ([]string, error) {
	clean := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[strings.ToLower(tag)] {
			continue
		}
		if utf8.RuneCountInString(tag) > maxTag {
			return nil, ErrInvalidBestiaryRequest
		}
		seen[strings.ToLower(tag)] = true
		clean = append(clean, tag)
	}
	if len(clean) > maxTags {
		return nil, ErrInvalidBestiaryRequest
	}
	return clean, nil
}

// listedCollection is whether collection c is in the list of user $1: theirs,
// or subscribed to and public (the rule of can_view_collection, migration
// 000035). A subscription outlives a private spell of its collection.
const listedCollection = `(
    c.owner_id = $1
    OR c.visibility = 'public'
       AND EXISTS (SELECT 1 FROM bestiary_subscriptions s WHERE s.user_id = $1 AND s.collection_id = c.id))`

// access fails unless the user may view, or with mustOwn change, what owner
// owns. What the user cannot view is ErrNoRecord, as a missing id: the id
// tells nothing of a private collection.
func access(owner, userID int, viewable, mustOwn bool) error {
	switch {
	case owner == userID:
		return nil
	case !viewable:
		return ErrNoRecord
	case mustOwn:
		return ErrPermissionDenied
	}
	return nil
}

func collectionAccess(ctx context.Context, q querier, userID, collectionID int, mustOwn bool) error {
	var owner int
	var viewable bool
	err := q.QueryRow(ctx, `
        SELECT c.owner_id, can_view_collection($1, c.id)
        FROM bestiary_collections c WHERE c.id = $2`, userID, collectionID).Scan(&owner, &viewable)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoRecord
	}
	if err != nil {
		return err
	}
	return access(owner, userID, viewable, mustOwn)
}

// ownCollection fails unless the collection is the user's: ErrPermissionDenied
// for another user's they can view, ErrNoRecord otherwise.
func ownCollection(ctx context.Context, q querier, userID, collectionID int) error {
	return collectionAccess(ctx, q, userID, collectionID, true)
}

// viewCollection fails with ErrNoRecord unless the user can view the collection.
func viewCollection(ctx context.Context, q querier, userID, collectionID int) error {
	return collectionAccess(ctx, q, userID, collectionID, false)
}

func creatureAccess(ctx context.Context, q querier, userID, creatureID int, mustOwn bool) (int, error) {
	var collectionID, owner int
	var viewable bool
	err := q.QueryRow(ctx, `
        SELECT c.id, c.owner_id, can_view_collection($1, c.id)
        FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id
        WHERE cs.id = $2`, userID, creatureID).Scan(&collectionID, &owner, &viewable)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNoRecord
	}
	if err != nil {
		return 0, err
	}
	return collectionID, access(owner, userID, viewable, mustOwn)
}

// ownCreature fails unless the sheet is a creature in a collection of the
// user, as ownCollection does; it returns the collection.
func ownCreature(ctx context.Context, q querier, userID, creatureID int) (int, error) {
	return creatureAccess(ctx, q, userID, creatureID, true)
}

// viewCreature fails with ErrNoRecord unless the sheet is a creature the user
// can view.
func viewCreature(ctx context.Context, q querier, userID, creatureID int) error {
	_, err := creatureAccess(ctx, q, userID, creatureID, false)
	return err
}

// likePattern escapes what ILIKE reads as wildcards in a search query.
func likePattern(query string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(query))
}

// touchCollections puts the collections first in the list, as the last
// changed: a creature came, went or changed in them.
func touchCollections(ctx context.Context, q querier, ids ...int) error {
	_, err := q.Exec(ctx, `UPDATE bestiary_collections SET updated_at = now() WHERE id = ANY($1)`, ids)
	return err
}

// collectionColumns are read as user $1 sees them: every query of them passes
// the user first.
const collectionColumns = `
    c.id, c.owner_id = $1, (SELECT name FROM users WHERE id = c.owner_id),
    c.name, c.description, c.tags, c.visibility, c.is_default, c.published_at, c.updated_at,
    EXISTS (SELECT 1 FROM bestiary_subscriptions s WHERE s.user_id = $1 AND s.collection_id = c.id),
    (SELECT count(*) FROM character_sheets cs WHERE cs.collection_id = c.id)`

func scanCollection(row pgx.Row) (*BestiaryCollection, error) {
	c := &BestiaryCollection{}
	err := row.Scan(&c.ID, &c.Own, &c.Owner, &c.Name, &c.Description, &c.Tags, &c.Visibility, &c.Default, &c.PublishedAt, &c.UpdatedAt, &c.Subscribed, &c.Creatures)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	return c, err
}

func loadCollection(ctx context.Context, q querier, userID, collectionID int) (*BestiaryCollection, error) {
	return scanCollection(q.QueryRow(ctx, `SELECT`+collectionColumns+` FROM bestiary_collections c WHERE c.id = $2`, userID, collectionID))
}

// The columns of a creature leave the content out: a list of them would
// unpack every sheet.
const creatureColumns = `
    cs.id, cs.collection_id, cs.character_name, cs.sheet_kind, cs.tags, cs.source_label, cs.updated_at`

func scanCreature(row pgx.Row) (Creature, error) {
	var c Creature
	err := row.Scan(&c.ID, &c.CollectionID, &c.Name, &c.Kind, &c.Tags, &c.SourceLabel, &c.UpdatedAt)
	return c, err
}

func loadCreature(ctx context.Context, q querier, creatureID int) (*Creature, error) {
	c, err := scanCreature(q.QueryRow(ctx, `SELECT`+creatureColumns+` FROM character_sheets cs WHERE cs.id = $1`, creatureID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	return &c, err
}

// inTx runs `do` in one transaction.
func (m *BestiaryModel) inTx(ctx context.Context, do func(tx pgx.Tx) error) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := do(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (m *BestiaryModel) Get(ctx context.Context, userID int) (*Bestiary, error) {
	// The user's own first: the default one, then the last changed first;
	// then the subscriptions, the last made first.
	rows, err := m.DB.Query(ctx, `
        SELECT`+collectionColumns+`
        FROM bestiary_collections c
        LEFT JOIN bestiary_subscriptions s ON s.user_id = $1 AND s.collection_id = c.id
        WHERE `+listedCollection+`
        ORDER BY c.owner_id = $1 DESC, c.is_default DESC,
                 CASE WHEN c.owner_id = $1 THEN c.updated_at ELSE s.subscribed_at END DESC,
                 c.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	collections, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (BestiaryCollection, error) {
		c, err := scanCollection(row)
		if err != nil {
			return BestiaryCollection{}, err
		}
		return *c, nil
	})
	if err != nil {
		return nil, err
	}

	b := &Bestiary{Collections: collections, Quota: Quota{Limit: QuotaBytes}}
	if b.Quota.Used, err = quotaUsed(ctx, m.DB, userID); err != nil {
		return nil, err
	}
	// The tags of the collections and of the creatures are suggested apart.
	b.Tags.Collections, err = m.suggestTags(ctx, userID, `
        SELECT c.owner_id, c.visibility, tag, c.updated_at AS changed
        FROM bestiary_collections c, unnest(c.tags) AS tag`)
	if err != nil {
		return nil, err
	}
	b.Tags.Creatures, err = m.suggestTags(ctx, userID, `
        SELECT c.owner_id, c.visibility, tag, cs.updated_at AS changed
        FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id, unnest(cs.tags) AS tag`)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// suggestTags is the tags the user last used, then those most used in the
// public collections: never the tags of another user's private ones. `tagged`
// selects a row per tag: owner_id and visibility of its collection, the tag
// and when its row changed.
func (m *BestiaryModel) suggestTags(ctx context.Context, userID int, tagged string) ([]string, error) {
	rows, err := m.DB.Query(ctx, `
        WITH tagged AS (
            SELECT * FROM (`+tagged+`) t WHERE owner_id = $1 OR visibility = 'public'
        ), own AS (
            SELECT tag, max(changed) AS used FROM tagged WHERE owner_id = $1
            GROUP BY tag ORDER BY used DESC, tag LIMIT $2
        ), popular AS (
            SELECT tag, count(*) AS uses FROM tagged
            WHERE visibility = 'public' AND lower(tag) NOT IN (SELECT lower(tag) FROM own)
            GROUP BY tag ORDER BY uses DESC, tag LIMIT $2
        )
        SELECT tag FROM (
            SELECT tag, 1 AS part, row_number() OVER (ORDER BY used DESC, tag) AS pos FROM own
            UNION ALL
            SELECT tag, 2, row_number() OVER (ORDER BY uses DESC, tag) FROM popular
        ) t
        ORDER BY part, pos`, userID, maxTagSuggestions)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (m *BestiaryModel) CreateCollection(ctx context.Context, userID int, name string) (*BestiaryCollection, error) {
	name, ok := cleanName(name, maxCollectionName, false)
	if !ok {
		return nil, ErrInvalidBestiaryRequest
	}
	return scanCollection(m.DB.QueryRow(ctx, `
        INSERT INTO bestiary_collections AS c (owner_id, name) VALUES ($1, $2)
        RETURNING`+collectionColumns, userID, name))
}

func (m *BestiaryModel) UpdateCollection(ctx context.Context, userID, collectionID int, edit CollectionEdit) (*BestiaryCollection, error) {
	var name, description *string
	var tags []string
	if edit.Name != nil {
		n, ok := cleanName(*edit.Name, maxCollectionName, false)
		if !ok {
			return nil, ErrInvalidBestiaryRequest
		}
		name = &n
	}
	if edit.Description != nil {
		d, ok := cleanName(*edit.Description, maxDescription, true)
		if !ok {
			return nil, ErrInvalidBestiaryRequest
		}
		description = &d
	}
	if edit.Tags != nil {
		var err error
		if tags, err = cleanTags(*edit.Tags); err != nil {
			return nil, err
		}
	}
	if edit.Visibility != nil && !edit.Visibility.IsValid() {
		return nil, ErrInvalidBestiaryRequest
	}
	if err := ownCollection(ctx, m.DB, userID, collectionID); err != nil {
		return nil, err
	}
	// Each time the collection becomes public it goes to the top of the
	// catalog. The default collection stays private: no row, and the request
	// is refused.
	c, err := scanCollection(m.DB.QueryRow(ctx, `
        UPDATE bestiary_collections AS c
        SET name = COALESCE($3, name),
            description = COALESCE($4, description),
            tags = COALESCE($5, tags),
            visibility = COALESCE($6::collection_visibility, visibility),
            published_at = CASE WHEN $6 = 'public' AND visibility <> 'public' THEN now() ELSE published_at END,
            updated_at = now()
        WHERE c.id = $2 AND NOT (c.is_default AND $6 IS NOT DISTINCT FROM 'public')
        RETURNING`+collectionColumns, userID, collectionID, name, description, tags, edit.Visibility))
	if errors.Is(err, ErrNoRecord) {
		return nil, ErrInvalidBestiaryRequest
	}
	return c, err
}

func (m *BestiaryModel) Collection(ctx context.Context, userID, collectionID int) (*BestiaryCollection, error) {
	c, err := loadCollection(ctx, m.DB, userID, collectionID)
	if err != nil {
		return nil, err
	}
	if !c.Own && c.Visibility != VisibilityPublic {
		return nil, ErrNoRecord
	}
	return c, nil
}

func (m *BestiaryModel) Subscribe(ctx context.Context, userID, collectionID int) (*BestiaryCollection, error) {
	c, err := m.Collection(ctx, userID, collectionID)
	if err != nil {
		return nil, err
	}
	if c.Own {
		return nil, ErrInvalidBestiaryRequest
	}
	_, err = m.DB.Exec(ctx, `
        INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2)
        ON CONFLICT (user_id, collection_id) DO NOTHING`, userID, collectionID)
	c.Subscribed = true
	return c, err
}

func (m *BestiaryModel) Unsubscribe(ctx context.Context, userID, collectionID int) error {
	_, err := m.DB.Exec(ctx, `DELETE FROM bestiary_subscriptions WHERE user_id = $1 AND collection_id = $2`, userID, collectionID)
	return err
}

func (m *BestiaryModel) Catalog(ctx context.Context, userID int, filter CatalogFilter) (*CatalogPage, error) {
	order, past := "DESC", "<"
	if filter.Oldest {
		order, past = "ASC", ">"
	}
	var afterAt *time.Time
	var afterID int
	if filter.After != nil {
		afterAt, afterID = &filter.After.PublishedAt, filter.After.ID
	}
	// A row past the page tells whether there is more.
	rows, err := m.DB.Query(ctx, `
        SELECT c.id, c.name, u.name, c.owner_id = $1,
               (SELECT count(*) FROM character_sheets cs WHERE cs.collection_id = c.id),
               c.tags, c.published_at
        FROM bestiary_collections c
        JOIN users u ON u.id = c.owner_id
        WHERE c.visibility = 'public'
          AND c.name ILIKE '%' || $2 || '%'
          AND ($3 = '' OR c.tags @> ARRAY[$3])
          AND ($5::timestamptz IS NULL OR (c.published_at, c.id) `+past+` ($5, $6))
        ORDER BY c.published_at `+order+`, c.id `+order+`
        LIMIT $4`,
		userID, likePattern(filter.Query), strings.TrimSpace(filter.Tag), catalogPage+1, afterAt, afterID)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CatalogRow, error) {
		var c CatalogRow
		return c, row.Scan(&c.ID, &c.Name, &c.Owner, &c.Own, &c.Creatures, &c.Tags, &c.PublishedAt)
	})
	if err != nil {
		return nil, err
	}
	page := &CatalogPage{Rows: all[:min(len(all), catalogPage)]}
	if len(all) > catalogPage {
		last := page.Rows[len(page.Rows)-1]
		next := CatalogCursor{PublishedAt: last.PublishedAt, ID: last.ID}.String()
		page.Next = &next
	}
	return page, nil
}

func (m *BestiaryModel) DeleteCollection(ctx context.Context, userID, collectionID int) ([]int, error) {
	var creatures []int
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		if err := ownCollection(ctx, tx, userID, collectionID); err != nil {
			return err
		}
		var isDefault bool
		if err := tx.QueryRow(ctx, `SELECT is_default FROM bestiary_collections WHERE id = $1`, collectionID).Scan(&isDefault); err != nil {
			return err
		}
		if isDefault {
			return ErrInvalidBestiaryRequest
		}
		rows, err := tx.Query(ctx, `SELECT id FROM character_sheets WHERE collection_id = $1 ORDER BY id`, collectionID)
		if err != nil {
			return err
		}
		if creatures, err = pgx.CollectRows(rows, pgx.RowTo[int]); err != nil {
			return err
		}
		// Its creatures go with it; their NPC copies forget their source.
		_, err = tx.Exec(ctx, `DELETE FROM bestiary_collections WHERE id = $1`, collectionID)
		return err
	})
	return creatures, err
}

func (m *BestiaryModel) Export(ctx context.Context, userID, collectionID int) (*CollectionFile, error) {
	if err := ownCollection(ctx, m.DB, userID, collectionID); err != nil {
		return nil, err
	}
	f := &CollectionFile{Format: CollectionFileFormat, Version: CollectionFileVersion}
	err := m.DB.QueryRow(ctx, `SELECT name, description, tags FROM bestiary_collections WHERE id = $1`, collectionID).
		Scan(&f.Name, &f.Description, &f.Tags)
	if err != nil {
		return nil, err
	}
	rows, err := m.DB.Query(ctx, `
        SELECT sheet_kind, tags, content FROM character_sheets
        WHERE collection_id = $1
        ORDER BY lower(character_name), id`, collectionID)
	if err != nil {
		return nil, err
	}
	f.Creatures, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (CreatureInFile, error) {
		var c CreatureInFile
		return c, row.Scan(&c.SheetKind, &c.Tags, &c.Content)
	})
	return f, err
}

func (m *BestiaryModel) Upload(ctx context.Context, userID, collectionID int, creatures []CreatureInFile) (int, error) {
	type checked struct {
		kind    SheetKind
		tags    []string
		content json.RawMessage
	}
	var all []checked
	for _, c := range creatures {
		kind, content, ok := sheetFromFile(c.SheetKind, c.Content)
		if !ok {
			return 0, ErrInvalidBestiaryRequest
		}
		tags, err := cleanTags(c.Tags)
		if err != nil {
			return 0, err
		}
		all = append(all, checked{kind, tags, content})
	}
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		if err := ownCollection(ctx, tx, userID, collectionID); err != nil {
			return err
		}
		if len(all) == 0 {
			return nil
		}
		before, err := lockQuota(ctx, tx, userID)
		if err != nil {
			return err
		}
		for _, c := range all {
			// A creature has not rolled: its initiative is its NPCs'.
			_, err := tx.Exec(ctx, `
                INSERT INTO character_sheets (owner_id, collection_id, sheet_kind, content, tags, created_at, updated_at)
                VALUES ($1, $2, $3, jsonb_set($4::jsonb, '`+lastInitiativePath+`', '0'), $5, now(), now())`,
				userID, collectionID, c.kind, c.content, c.tags)
			if err != nil {
				return err
			}
		}
		if err := checkQuota(ctx, tx, userID, before); err != nil {
			return err
		}
		return touchCollections(ctx, tx, collectionID)
	})
	if err != nil {
		return 0, err
	}
	return len(all), nil
}

func (m *BestiaryModel) Creatures(ctx context.Context, userID int, filter CreatureFilter) ([]Creature, error) {
	// One collection the user can view, or all those in their list: their own
	// and the public ones they subscribed to.
	if filter.CollectionID != nil {
		if err := viewCollection(ctx, m.DB, userID, *filter.CollectionID); err != nil {
			return nil, err
		}
	}
	// The collections are picked first: can_view_collection runs once a
	// collection, not once a creature.
	rows, err := m.DB.Query(ctx, `
        WITH picked AS (
            SELECT c.id FROM bestiary_collections c
            WHERE $2::int IS NULL AND `+listedCollection+` OR c.id = $2
        )
        SELECT`+creatureColumns+`
        FROM character_sheets cs
        JOIN picked ON picked.id = cs.collection_id
        WHERE cs.character_name ILIKE '%' || $3 || '%'
          AND ($4 = '' OR cs.tags @> ARRAY[$4])
        ORDER BY lower(cs.character_name), cs.id`,
		userID, filter.CollectionID, likePattern(filter.Query), strings.TrimSpace(filter.Tag))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Creature, error) { return scanCreature(row) })
}

func (m *BestiaryModel) NewCreature(ctx context.Context, userID, collectionID int, kind SheetKind) (*Creature, error) {
	if !kind.IsValid() {
		return nil, ErrInvalidBestiaryRequest
	}
	content, err := currentShape(json.RawMessage(defaultContent), kind)
	if err != nil {
		return nil, err
	}
	var creature *Creature
	err = m.inTx(ctx, func(tx pgx.Tx) error {
		if err := ownCollection(ctx, tx, userID, collectionID); err != nil {
			return err
		}
		before, err := lockQuota(ctx, tx, userID)
		if err != nil {
			return err
		}
		var id int
		err = tx.QueryRow(ctx, `
            INSERT INTO character_sheets (owner_id, collection_id, sheet_kind, content, created_at, updated_at)
            VALUES ($1, $2, $3, jsonb_set($4::jsonb, '`+creatureNamePath+`', to_jsonb($5::text)), now(), now())
            RETURNING id`, userID, collectionID, kind, content, newCreatureName).Scan(&id)
		if err != nil {
			return err
		}
		if err := checkQuota(ctx, tx, userID, before); err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, id)
		return err
	})
	return creature, err
}

func (m *BestiaryModel) UpdateCreature(ctx context.Context, userID, creatureID int, edit CreatureEdit) (*Creature, error) {
	var name *string
	var tags []string
	if edit.Name != nil {
		n, ok := cleanName(*edit.Name, maxCreatureName, false)
		if !ok {
			return nil, ErrInvalidBestiaryRequest
		}
		name = &n
	}
	if edit.Tags != nil {
		var err error
		if tags, err = cleanTags(*edit.Tags); err != nil {
			return nil, err
		}
	}
	var creature *Creature
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		collectionID, err := ownCreature(ctx, tx, userID, creatureID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
            UPDATE character_sheets
            SET content = CASE WHEN $2::text IS NULL THEN content
                               ELSE jsonb_set(content, '`+creatureNamePath+`', to_jsonb($2::text)) END,
                tags = COALESCE($3, tags),
                version = version + 1,
                updated_at = now()
            WHERE id = $1`, creatureID, name, tags)
		if err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, creatureID)
		return err
	})
	return creature, err
}

// targetCollection is the id of the user's collection the target names; a
// new collection is made in the transaction of the copy, so that a copy that
// fails leaves none.
func targetCollection(ctx context.Context, tx pgx.Tx, userID int, target CollectionTarget) (int, error) {
	if target.NewCollection == "" {
		return target.CollectionID, ownCollection(ctx, tx, userID, target.CollectionID)
	}
	if target.CollectionID != 0 {
		return 0, ErrInvalidBestiaryRequest
	}
	name, ok := cleanName(target.NewCollection, maxCollectionName, false)
	if !ok {
		return 0, ErrInvalidBestiaryRequest
	}
	var id int
	err := tx.QueryRow(ctx, `INSERT INTO bestiary_collections (owner_id, name) VALUES ($1, $2) RETURNING id`, userID, name).Scan(&id)
	return id, err
}

func (m *BestiaryModel) CopyCreature(ctx context.Context, userID, creatureID int, target CollectionTarget) (*Creature, error) {
	var creature *Creature
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		if err := viewCreature(ctx, tx, userID, creatureID); err != nil {
			return err
		}
		collectionID, err := targetCollection(ctx, tx, userID, target)
		if err != nil {
			return err
		}
		src, err := loadCreature(ctx, tx, creatureID)
		if err != nil {
			return err
		}
		copyID, err := copySheet(ctx, tx, userID, creatureID, SheetHome{CollectionID: &collectionID}, src.Name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET tags = $2 WHERE id = $1`, copyID, src.Tags); err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, copyID)
		return err
	})
	return creature, err
}

func (m *BestiaryModel) MoveCreature(ctx context.Context, userID, creatureID, collectionID int) (*Creature, error) {
	var creature *Creature
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		from, err := ownCreature(ctx, tx, userID, creatureID)
		if err != nil {
			return err
		}
		if err := ownCollection(ctx, tx, userID, collectionID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET collection_id = $2, updated_at = now() WHERE id = $1`, creatureID, collectionID); err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, from, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, creatureID)
		return err
	})
	return creature, err
}

func (m *BestiaryModel) DeleteCreature(ctx context.Context, userID, creatureID int) error {
	return m.inTx(ctx, func(tx pgx.Tx) error {
		collectionID, err := ownCreature(ctx, tx, userID, creatureID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = $1`, creatureID); err != nil {
			return err
		}
		return touchCollections(ctx, tx, collectionID)
	})
}

func (m *BestiaryModel) Save(ctx context.Context, userID, sheetID int, target CollectionTarget) (*Creature, error) {
	var creature *Creature
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		collectionID, err := targetCollection(ctx, tx, userID, target)
		if err != nil {
			return err
		}
		var name string
		err = tx.QueryRow(ctx, `SELECT character_name FROM character_sheets WHERE id = $1`, sheetID).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoRecord
		}
		if err != nil {
			return err
		}
		// copySheet checks that the user can view the sheet.
		copyID, err := copySheet(ctx, tx, userID, sheetID, SheetHome{CollectionID: &collectionID}, name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET content = jsonb_set(content, '`+lastInitiativePath+`', '0') WHERE id = $1`, copyID); err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, copyID)
		return err
	})
	return creature, err
}

func (m *BestiaryModel) AddVariant(ctx context.Context, userID, sheetID int, name string) (*Creature, int, error) {
	name, ok := cleanName(name, maxCreatureName, true)
	if !ok {
		return nil, 0, ErrInvalidBestiaryRequest
	}
	var creature *Creature
	var encounterID int
	err := m.inTx(ctx, func(tx pgx.Tx) error {
		var source *int
		var npcName string
		err := tx.QueryRow(ctx, `
            SELECT source_sheet_id, encounter_id, character_name FROM character_sheets
            WHERE id = $1 AND encounter_id IS NOT NULL AND can_edit_character_sheet($2, $1)
            FOR UPDATE`, sheetID, userID).Scan(&source, &encounterID, &npcName)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		// Only an NPC of the user's own creature: the variant goes next to it.
		if source == nil {
			return ErrInvalidBestiaryRequest
		}
		collectionID, err := ownCreature(ctx, tx, userID, *source)
		if errors.Is(err, ErrNoRecord) || errors.Is(err, ErrPermissionDenied) {
			return ErrInvalidBestiaryRequest
		}
		if err != nil {
			return err
		}
		if name == "" {
			name = npcName
		}
		variantID, err := copySheet(ctx, tx, userID, sheetID, SheetHome{CollectionID: &collectionID}, name)
		if err != nil {
			return err
		}
		// A creature has not rolled: its initiative is its NPCs'.
		_, err = tx.Exec(ctx, `
            UPDATE character_sheets v
            SET tags = src.tags, content = jsonb_set(v.content, '`+lastInitiativePath+`', '0')
            FROM character_sheets src
            WHERE v.id = $1 AND src.id = $2`, variantID, *source)
		if err != nil {
			return err
		}
		// The next variant and the source label go from this one; the other NPCs
		// of the old creature keep it.
		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET source_sheet_id = $2 WHERE id = $1`, sheetID, variantID); err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, variantID)
		return err
	})
	if err != nil {
		return nil, 0, err
	}
	return creature, encounterID, nil
}
