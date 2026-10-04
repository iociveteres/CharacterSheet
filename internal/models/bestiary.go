package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
// or too long name, a file that is no sheet, a public or deleted default
// collection, a subscription to the user's own collection.
var ErrInvalidBestiaryRequest = errors.New("models: invalid bestiary request")

const (
	maxCollectionName  = 100
	maxDescription     = 2000
	maxCreatureName    = 200
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
	Visibility  *CollectionVisibility `json:"visibility"`
}

// CatalogFilter narrows the public collections to names with Query in them.
// Oldest turns the order: the first published first. After is the next page's
// cursor of the page before, nil for the first page.
type CatalogFilter struct {
	Query  string
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

// CreatureFilter narrows the creatures of the user: to a collection, to names
// with Query in them.
type CreatureFilter struct {
	CollectionID *int
	Query        string
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
    c.name, c.description, c.visibility, c.is_default, c.published_at, c.updated_at,
    EXISTS (SELECT 1 FROM bestiary_subscriptions s WHERE s.user_id = $1 AND s.collection_id = c.id),
    (SELECT count(*) FROM character_sheets cs WHERE cs.collection_id = c.id)`

func scanCollection(row pgx.Row) (*BestiaryCollection, error) {
	c := &BestiaryCollection{}
	err := row.Scan(&c.ID, &c.Own, &c.Owner, &c.Name, &c.Description, &c.Visibility, &c.Default, &c.PublishedAt, &c.UpdatedAt, &c.Subscribed, &c.Creatures)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	return c, err
}

func loadCollection(ctx context.Context, q querier, userID, collectionID int) (*BestiaryCollection, error) {
	return scanCollection(q.QueryRow(ctx, `SELECT`+collectionColumns+` FROM bestiary_collections c WHERE c.id = $2`, userID, collectionID))
}

// The columns of a creature for user $1 leave the content out: a list of
// them would unpack every sheet.
const creatureColumns = `
    cs.id, cs.collection_id, cs.character_name, cs.sheet_kind, cs.source_label,
    `+authorName+`, COALESCE(cs.author_id = $1, false), cs.updated_at`

// authorName is the name of the author of sheet cs: the user's, else the one
// a file named.
const authorName = `COALESCE((SELECT u.name FROM users u WHERE u.id = cs.author_id), cs.author_label)`

// fileAuthor is author_id and author_label, in this order, of a sheet that
// user $1 brings from a file naming author $2: none, or the user's own name,
// is the user.
const fileAuthor = `
    CASE WHEN $2::text IS NULL OR $2 = (SELECT name FROM users WHERE id = $1) THEN $1::int END,
    CASE WHEN $2::text <> (SELECT name FROM users WHERE id = $1) THEN $2 END`

func scanCreature(row pgx.Row) (Creature, error) {
	var c Creature
	err := row.Scan(&c.ID, &c.CollectionID, &c.Name, &c.Kind, &c.SourceLabel, &c.Author, &c.ByYou, &c.UpdatedAt)
	return c, err
}

func loadCreature(ctx context.Context, q querier, userID, creatureID int) (*Creature, error) {
	c, err := scanCreature(q.QueryRow(ctx, `SELECT`+creatureColumns+` FROM character_sheets cs WHERE cs.id = $2`, userID, creatureID))
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
	return b, nil
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
            visibility = COALESCE($5::collection_visibility, visibility),
            published_at = CASE WHEN $5 = 'public' AND visibility <> 'public' THEN now() ELSE published_at END,
            updated_at = now()
        WHERE c.id = $2 AND NOT (c.is_default AND $5 IS NOT DISTINCT FROM 'public')
        RETURNING`+collectionColumns, userID, collectionID, name, description, edit.Visibility))
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
        SELECT c.id, c.name, u.name, c.description, c.owner_id = $1,
               (SELECT count(*) FROM character_sheets cs WHERE cs.collection_id = c.id),
               c.published_at
        FROM bestiary_collections c
        JOIN users u ON u.id = c.owner_id
        WHERE c.visibility = 'public'
          AND c.name ILIKE '%' || $2 || '%'
          AND ($4::timestamptz IS NULL OR (c.published_at, c.id) `+past+` ($4, $5))
        ORDER BY c.published_at `+order+`, c.id `+order+`
        LIMIT $3`,
		userID, likePattern(filter.Query), catalogPage+1, afterAt, afterID)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CatalogRow, error) {
		var c CatalogRow
		return c, row.Scan(&c.ID, &c.Name, &c.Owner, &c.Description, &c.Own, &c.Creatures, &c.PublishedAt)
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
	err := m.DB.QueryRow(ctx, `SELECT name, description FROM bestiary_collections WHERE id = $1`, collectionID).
		Scan(&f.Name, &f.Description)
	if err != nil {
		return nil, err
	}
	rows, err := m.DB.Query(ctx, `
        SELECT cs.sheet_kind, cs.content, `+authorName+` FROM character_sheets cs
        WHERE cs.collection_id = $1
        ORDER BY lower(cs.character_name), cs.id`, collectionID)
	if err != nil {
		return nil, err
	}
	f.Creatures, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (CreatureInFile, error) {
		var c CreatureInFile
		return c, row.Scan(&c.SheetKind, &c.Content, &c.Author)
	})
	return f, err
}

func (m *BestiaryModel) Upload(ctx context.Context, userID, collectionID int, creatures []CreatureInFile) (int, error) {
	type checked struct {
		kind    SheetKind
		content json.RawMessage
		author  *string
	}
	var all []checked
	for _, c := range creatures {
		kind, content, ok := sheetFromFile(c.SheetKind, c.Content)
		if !ok {
			return 0, ErrInvalidBestiaryRequest
		}
		author, ok := cleanOptional(c.Author, maxAuthorLabel)
		if !ok {
			return 0, ErrInvalidBestiaryRequest
		}
		all = append(all, checked{kind, content, author})
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
                INSERT INTO character_sheets (owner_id, author_id, author_label, collection_id, sheet_kind, content, created_at, updated_at)
                VALUES ($1, `+fileAuthor+`, $3, $4, jsonb_set($5::jsonb, '`+lastInitiativePath+`', '0'), now(), now())`,
				userID, c.author, collectionID, c.kind, c.content)
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
        ORDER BY lower(cs.character_name), cs.id`,
		userID, filter.CollectionID, likePattern(filter.Query))
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
            INSERT INTO character_sheets (owner_id, author_id, collection_id, sheet_kind, content, created_at, updated_at)
            VALUES ($1, $1, $2, $3, jsonb_set($4::jsonb, '`+creatureNamePath+`', to_jsonb($5::text)), now(), now())
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
		creature, err = loadCreature(ctx, tx, userID, id)
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
		src, err := loadCreature(ctx, tx, userID, creatureID)
		if err != nil {
			return err
		}
		copyID, err := copySheet(ctx, tx, userID, creatureID, SheetHome{CollectionID: &collectionID}, src.Name)
		if err != nil {
			return err
		}
		if err := touchCollections(ctx, tx, collectionID); err != nil {
			return err
		}
		creature, err = loadCreature(ctx, tx, userID, copyID)
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
		creature, err = loadCreature(ctx, tx, userID, creatureID)
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
		creature, err = loadCreature(ctx, tx, userID, copyID)
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
            UPDATE character_sheets SET content = jsonb_set(content, '`+lastInitiativePath+`', '0')
            WHERE id = $1`, variantID)
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
		creature, err = loadCreature(ctx, tx, userID, variantID)
		return err
	})
	if err != nil {
		return nil, 0, err
	}
	return creature, encounterID, nil
}
