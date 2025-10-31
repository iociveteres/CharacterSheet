package models

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userID, RoomID int) (int, error)
	InsertWithContent(ctx context.Context, userID, roomID int, content json.RawMessage) (int, error)
	Delete(ctx context.Context, userID, sheetID int) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userID int) ([]*CharacterSheet, error)

	// JSON
	CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error)
	ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error)
	ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error)
	DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error)
	ReplacePositions(ctx context.Context, userID, sheetID int, gridID string, positions map[string]Position) (int, error)

	// DTO
	SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error)
	GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error)
}

type CharacterSheet struct {
	ID            int
	OwnerID       int
	RoomID        int
	CharacterName string
	Content       json.RawMessage
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

type CharacterSheetContent struct {
	CharacterInfo   CharacterInfo               `json:"character-info"`
	Characteristics map[string]Characteristic   `json:"characteristics"`
	SkillsLeft      map[string]Skill            `json:"skills-left"`
	SkillsRight     map[string]Skill            `json:"skills-right"`
	CustomSkills    map[string]Skill            `json:"custom-skills"`
	Notes           map[string]Note             `json:"notes"`
	InfamyPoints    InfamyPoints                `json:"infamy-points"`
	Fatigue         Fatigue                     `json:"fatigue"`
	Initiative      int                         `json:"initiative"`
	Size            int                         `json:"size"`
	Movement        Movement                    `json:"movement"`
	Armour          Armour                      `json:"armour"`
	RangedAttacks   map[string]RangedAttack     `json:"ranged-attack"`
	MeleeAttacks    map[string]MeleeAttack      `json:"melee-attack"`
	Traits          map[string]NamedDescription `json:"traits"`
	Talents         map[string]NamedDescription `json:"talents"`
	CarryWeight     CarryWeightAndEncumbrance   `json:"carry-weight-and-encumbrance"`
	Gear            map[string]GearItem         `json:"gear"`
	Cybernetics     map[string]NamedDescription `json:"cybernetics"`
	Experience      Experience                  `json:"experience"`
	Mutations       map[string]NamedDescription `json:"mutations"`
	MentalDisorders map[string]NamedDescription `json:"mental-disorders"`
	Diseases        map[string]NamedDescription `json:"diseases"`
	Psykana         Psykana                     `json:"psykana"`

	Layouts Layouts `json:"layouts"`
}

// small helper structs
type CharacterInfo struct {
	CharacterName string `json:"character-name"`
	Archetype     string `json:"archetype"`
	Race          string `json:"race"`
	WarbandName   string `json:"warband-name"`
	Pride         string `json:"pride"`
	Gender        string `json:"gender"`
	Age           string `json:"age"`
	Complexion    string `json:"complexion"`
	Disgrace      string `json:"disgrace"`
	Motivation    string `json:"motivation"`
}

type Characteristic struct {
	Value     string `json:"value"`
	Unnatural string `json:"unnatural,omitempty"`
}

type Skill struct {
	Name           string `json:"name,omitempty"`
	Characteristic string `json:"characteristic"`
	Plus0          bool   `json:"+0,omitempty"`
	Plus10         bool   `json:"+10,omitempty"`
	Plus20         bool   `json:"+20,omitempty"`
	Plus30         bool   `json:"+30,omitempty"`
	Difficulty     int    `json:"difficulty,omitempty"`
}

type Note struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type InfamyPoints struct {
	InfamyMax  int `json:"infamy_max"`
	InfamyCur  int `json:"infamy_cur"`
	InfamyTemp int `json:"infamy_temp"`
}

type Fatigue struct {
	FatigueMax int `json:"fatigue_max"`
	FatigueCur int `json:"fatigue_cur"`
}

type Movement struct {
	MoveHalf   int `json:"move_half"`
	MoveFull   int `json:"move_full"`
	MoveCharge int `json:"move_charge"`
	MoveRun    int `json:"move_run"`
}

type Armour struct {
	Head                         int `json:"armour-head"`
	LeftArm                      int `json:"armour-left-arm"`
	Body                         int `json:"armour-body"`
	RightArm                     int `json:"armour-right-arm"`
	LeftLeg                      int `json:"armour-left-leg"`
	RightLeg                     int `json:"armour-right-leg"`
	WoundsMax                    int `json:"wounds_max"`
	WoundsCur                    int `json:"wounds_cur"`
	ToughnessBaseAbsorptionValue int `json:"toughness-base-absorption-value"`
	NaturalArmourValue           int `json:"natural-armor-value"`
	MachineValue                 int `json:"machine-value"`
	DaemonicValue                int `json:"demonic-value"`
	OtherArmourValue             int `json:"other-armour-value"`
}

type RangedAttack struct {
	Name       string `json:"name"`
	Class      string `json:"class"`
	Range      string `json:"range"`
	Damage     string `json:"damage"`
	Pen        string `json:"pen"`
	DamageType string `json:"damage-type"`
	RoFSingle  string `json:"rof-single"`
	RoFShort   string `json:"rof-short"`
	RoFLong    string `json:"rof-long"`
	ClipCur    string `json:"clip-cur"`
	ClipMax    string `json:"clip-max"`
	Reload     string `json:"reload"`
	Special    string `json:"special"`
	Upgrades   string `json:"upgrades"`
}

type MeleeAttack struct {
	Name     string              `json:"name"`
	Group    string              `json:"group"`
	Grip     string              `json:"grip"`
	Balance  string              `json:"balance"`
	Upgrades string              `json:"upgrades"`
	Tabs     map[string]MeleeTab `json:"tabs,omitempty"`
}

type MeleeTab struct {
	Profile    string `json:"profile"`
	Range      string `json:"range"`
	Damage     string `json:"damage"`
	Pen        string `json:"pen"`
	DamageType string `json:"damage-type"`
	Special    string `json:"special"`
}

type NamedDescription struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type GearItem struct {
	Name        string  `json:"name"`
	Weight      float64 `json:"weight"`
	Description string  `json:"description"`
}

type CarryWeightAndEncumbrance struct {
	CarryWeightBase int     `json:"carry-weight-base"`
	Encumbrance     float64 `json:"encumbrance"`
	CarryWeight     float64 `json:"carry-weight"`
	LiftWeight      float64 `json:"lift-weight"`
	PushWeight      float64 `json:"push-weight"`
}

type Experience struct {
	Total     int                       `json:"experience-total"`
	Spent     int                       `json:"experience-spent"`
	Remaining int                       `json:"experience-remaining"`
	Log       map[string]ExperienceItem `json:"experience-log"`
}

type ExperienceItem struct {
	Name           string `json:"name"`
	ExperienceCost int    `json:"experience-cost"`
}

type Psykana struct {
	PsykanaType     string                  `json:"psykana-type"`
	MaxPush         int                     `json:"max-push"`
	BasePR          int                     `json:"base-pr"`
	SustainedPowers int                     `json:"sustained-powers"`
	EffectivePR     int                     `json:"effective-pr"`
	PsychicPowers   map[string]PsychicPower `json:"psychic-powers"`
}

type PsychicPower struct {
	Name        string `json:"name"`
	Subtypes    string `json:"subtypes"`
	Range       string `json:"range"`
	Psychotest  string `json:"psychotest"`
	Action      string `json:"action"`
	Sustained   string `json:"sustained"`
	WeaponRange string `json:"weapon-range"`
	Damage      string `json:"damage"`
	Pen         string `json:"pen"`
	DamageType  string `json:"damage-type"`
	RoFSingle   string `json:"rof-single"`
	RoFShort    string `json:"rof-short"`
	RoFLong     string `json:"rof-long"`
	Special     string `json:"special"`
	Effect      string `json:"effect"`
}

type Position struct {
	ColIndex int `json:"colIndex"`
	RowIndex int `json:"rowIndex"`
}

type Layouts struct {
	CustomSkills    map[string]Position `json:"custom-skills,omitempty"`
	Notes           map[string]Position `json:"notes,omitempty"`
	RangedAttacks   map[string]Position `json:"ranged-attack,omitempty"`
	MeleeAttacks    map[string]Position `json:"melee-attack,omitempty"`
	Traits          map[string]Position `json:"traits,omitempty"`
	Talents         map[string]Position `json:"talents,omitempty"`
	Gear            map[string]Position `json:"gear,omitempty"`
	Cybernetics     map[string]Position `json:"cybernetics,omitempty"`
	ExperienceLog   map[string]Position `json:"experience-log,omitempty"`
	Mutations       map[string]Position `json:"mutations,omitempty"`
	MentalDisorders map[string]Position `json:"mental-disorders,omitempty"`
	Diseases        map[string]Position `json:"diseases,omitempty"`
	PsychicPowers   map[string]Position `json:"psychic-powers,omitempty"`
}

const defaultContent = `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
  	"experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
	"psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`

func (m *CharacterSheetModel) Insert(ctx context.Context, userID, roomID int) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, room_id, content, created_at, updated_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	// QueryRow will run the INSERT and scan the returned id
	err := m.DB.QueryRow(ctx, stmt, userID, roomID, defaultContent).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// InsertWithContent creates a new character sheet with provided JSON content
func (m *CharacterSheetModel) InsertWithContent(ctx context.Context, userID, roomID int, content json.RawMessage) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, room_id, content, created_at, updated_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	err := m.DB.QueryRow(ctx, stmt, userID, roomID, content).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Delete(ctx context.Context, userID, sheetID int) (int, error) {
	stmt := `
        DELETE FROM character_sheets
        WHERE id = $1
          AND can_edit_character_sheet($2, $1)
        RETURNING id
    `
	var id int
	err := m.DB.QueryRow(ctx, stmt, sheetID, userID).Scan(&id)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character-name' AS character_name, 
		content, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &CharacterSheet{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *CharacterSheetModel) ByUser(ctx context.Context, ownerID int) ([]*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character-name' AS character_name, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE owner_id = $1`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sheets := []*CharacterSheet{}

	for rows.Next() {
		s := &CharacterSheet{}
		if err := rows.Scan(
			&s.ID,
			&s.OwnerID,
			&s.CharacterName,
			&s.CreatedAt,
			&s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sheets = append(sheets, s)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return sheets, nil
}

type CharacterSheetSummary struct {
	CharacterSheet *CharacterSheet
	RoomName       string
}

func (m *CharacterSheetModel) SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error) {
	const stmt = `
SELECT
  cs.id,
  cs.owner_id,
  cs.room_id,
  r.name AS room_name,
  cs.content,
  cs.content->'character-info'->>'character-name' AS character_name,
  cs.created_at,
  cs.updated_at
FROM character_sheets AS cs
JOIN rooms AS r ON r.id = cs.room_id
WHERE cs.owner_id = $1
ORDER BY cs.updated_at DESC;`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []*CharacterSheetSummary

	for rows.Next() {
		var (
			id            int
			ownerID       int
			roomID        int
			roomName      string
			contentBytes  []byte
			characterName string
			createdAt     time.Time
			updatedAt     time.Time
		)

		if err := rows.Scan(
			&id,
			&ownerID,
			&roomID,
			&roomName,
			&contentBytes,
			&characterName,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}

		sheet := &CharacterSheet{
			ID:            id,
			OwnerID:       ownerID,
			RoomID:        roomID,
			CharacterName: characterName,
			Content:       json.RawMessage(contentBytes),
			CreatedAt:     createdAt,
			UpdatedAt:     updatedAt,
		}

		views = append(views, &CharacterSheetSummary{
			CharacterSheet: sheet,
			RoomName:       roomName,
		})
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return views, nil
}

// Create object at JSON path and corresponding Layout object, set it's content if provided
// - path: container path parts (e.g. {"melee-attack"} or {"melee-attack","melee-attack-XYZ","tabs"})
func (m *CharacterSheetModel) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error) {
	// pathForItem: path + itemID
	pathForItem := append(append([]string(nil), path...), itemID)

	// Case A: single top-level container -> create item AND set layouts.<grid>.<itemID> = pos
	if len(path) == 1 {
		const q = `
            UPDATE character_sheets
            SET content = jsonb_set(
                jsonb_set(content, $1::text[], $2::jsonb, true),
                $3::text[], $4::jsonb, true
            ),
            version = version + 1,
            updated_at = now()
            WHERE id = $6
              AND can_edit_character_sheet($5, $6)
            RETURNING version
        `
		path1 := pathForItem
		path2 := []string{"layouts", path[0], itemID}

		var version int
		err := m.DB.QueryRow(ctx, q, path1, init, path2, pos, userID, sheetID).Scan(&version)

		if err == pgx.ErrNoRows {
			return 0, ErrPermissionDenied
		}
		if err != nil {
			return 0, err
		}
		return version, nil
	}

	// Case B: nested path (len(path) >= 2)
	// We set the item at the nested path to initObj in one jsonb_set call.
	const qNested = `
        UPDATE character_sheets
        SET content = jsonb_set(content, $1::text[], $2::jsonb, true),
            version = version + 1,
            updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `

	var version int
	err := m.DB.QueryRow(ctx, qNested, pathForItem, init, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Set a scalar value at the exact JSON path
func (m *CharacterSheetModel) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	// Example path: []string{"characteristics","WS","value"}
	parentPath := path[:len(path)-1]
	// Single UPDATE: first ensure parent exists (set to {} if missing), then set the leaf.
	// jsonb_set is used twice:
	// 1) inner: jsonb_set(content, parentPath, COALESCE(content #> parentPath, '{}'::jsonb), true)
	//    -> creates the parent object if it doesn't exist.
	// 2) outer: jsonb_set(<result_of_inner>, fullPath, newValue, true)
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_set(content, $1::text[], COALESCE(content #> $1::text[], '{}'::jsonb), true),
            $2::text[], $3::jsonb, true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $4
          AND can_edit_character_sheet($5, $4)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, parentPath, path, newValueJSON, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Merge a partial object into content at the given JSON path
func (m *CharacterSheetModel) ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error) {
	// Merge semantics: coalesce(content #> path, '{}'::jsonb) || $2::jsonb
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            content,
            $1::text[],
            coalesce(content #> $1::text[], '{}'::jsonb) || $2::jsonb,
            true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, path, changes, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Update Layout position for an item (layouts.<grid>.positions.<item>)
func (m *CharacterSheetModel) ReplacePositions(ctx context.Context, userID, sheetID int, gridID string, positions map[string]Position) (int, error) {
	var valB []byte
	var err error
	if positions == nil {
		valB = []byte(`{}`)
	} else {
		valB, err = json.Marshal(positions)
		if err != nil {
			return 0, err
		}
	}
	// path to the grid within layouts
	path := []string{"layouts", gridID}
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(content, $1::text[], $2::jsonb, true),
            version = version + 1,
            updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err = m.DB.QueryRow(ctx, stmt, path, string(valB), sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Delete item at JSON path
func (m *CharacterSheetModel) DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error) {
	itemPath := append([]string(nil), path...)
	// e.g. path ["experience","experience-log","itemID"] -> layouts key "experience-log"
	layoutsKey := path[len(path)-2]
	layoutsPath := []string{"layouts", layoutsKey, path[len(path)-1]}
	const query = `
        UPDATE character_sheets
        SET content = (content #- $1::text[]) #- $2::text[],
            version = version + 1,
            updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, query, itemPath, layoutsPath, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

func (m *CharacterSheet) UnmarshalContent() (*CharacterSheetContent, error) {
	if len(m.Content) == 0 {
		return nil, ErrNoContent
	}

	var content CharacterSheetContent
	if err := json.Unmarshal(m.Content, &content); err != nil {
		return nil, err
	}

	return &content, nil
}

// DTO for view with permission info
type CharacterSheetView struct {
	CharacterSheet *CharacterSheet
	CanEdit        bool
}

func (m *CharacterSheetModel) GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error) {
	const stmt = `
        SELECT 
            cs.id,
            cs.owner_id,
            cs.content->'character-info'->>'character-name' AS character_name,
            cs.content,
            cs.created_at,
            cs.updated_at,
            can_edit_character_sheet($1, cs.id) AS can_edit
        FROM character_sheets cs
        WHERE cs.id = $2
    `

	row := m.DB.QueryRow(ctx, stmt, userID, sheetID)

	s := &CharacterSheet{}
	var canEdit bool

	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
		&canEdit,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	return &CharacterSheetView{
		CharacterSheet: s,
		CanEdit:        canEdit,
	}, nil
}
