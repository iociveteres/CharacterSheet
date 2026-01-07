package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userID, RoomID int) (int, error)
	InsertWithContent(ctx context.Context, userID, roomID int, content json.RawMessage) (int, error)
	Delete(ctx context.Context, userID, sheetID int) (int, error)
	ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userID int) ([]*CharacterSheet, error)

	// JSON
	CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error)
	ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error)
	ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error)
	DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error)
	ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]Position) (int, error)

	// DTO
	SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error)
	GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error)
}

type SheetVisibility string

const (
	VisibilityEveryoneCanEdit SheetVisibility = "everyone_can_edit"
	VisibilityEveryoneCanView SheetVisibility = "everyone_can_view"
	VisibilityEveryoneCanSee  SheetVisibility = "everyone_can_see"
	VisibilityHideFromPlayers SheetVisibility = "hide_from_players"
)

func (v SheetVisibility) IsValid() bool {
	switch v {
	case
		VisibilityEveryoneCanEdit,
		VisibilityEveryoneCanView,
		VisibilityEveryoneCanSee,
		VisibilityHideFromPlayers:
		return true
	default:
		return false
	}
}

func (v *SheetVisibility) Scan(src any) error {
	var s string

	switch x := src.(type) {
	case string:
		s = x
	case []byte:
		s = string(x)
	default:
		return fmt.Errorf("cannot scan %T into SheetVisibility", src)
	}

	val := SheetVisibility(s)
	if !val.IsValid() {
		return fmt.Errorf("invalid SheetVisibility value: %q", s)
	}

	*v = val
	return nil
}

func (v SheetVisibility) Value() (driver.Value, error) {
	if !v.IsValid() {
		return nil, fmt.Errorf("invalid SheetVisibility value: %q", v)
	}
	return string(v), nil
}

type CharacterSheet struct {
	ID            int
	OwnerID       int
	RoomID        int
	CharacterName string
	Content       json.RawMessage
	Visibility    SheetVisibility
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

type CharacterSheetContent struct {
	CharacterInfo    CharacterInfo              `json:"character-info" validate:"required"`
	Characteristics  map[string]Characteristic  `json:"characteristics" validate:"required"`
	SkillsLeft       map[string]Skill           `json:"skills-left" validate:"required"`
	SkillsRight      map[string]Skill           `json:"skills-right" validate:"required"`
	CustomSkills     ItemGrid[Skill]            `json:"custom-skills"`
	Notes            ItemGrid[Note]             `json:"notes"`
	InfamyPoints     InfamyPoints               `json:"infamy-points" validate:"required"`
	Fatigue          Fatigue                    `json:"fatigue" validate:"required"`
	ResourceTrackers ItemGrid[ResourceTracker]  `json:"resource-trackers"`
	Initiative       string                     `json:"initiative"`
	Size             int                        `json:"size"`
	Movement         Movement                   `json:"movement" validate:"required"`
	Armour           Armour                     `json:"armour" validate:"required"`
	PowerShields     ItemGrid[PowerShield]      `json:"power-shields"`
	RangedAttacks    ItemGrid[RangedAttack]     `json:"ranged-attack"`
	MeleeAttacks     ItemGrid[MeleeAttack]      `json:"melee-attack"`
	Traits           ItemGrid[NamedDescription] `json:"traits"`
	Talents          ItemGrid[NamedDescription] `json:"talents"`
	CarryWeight      CarryWeightAndEncumbrance  `json:"carry-weight-and-encumbrance" validate:"required"`
	Gear             ItemGrid[GearItem]         `json:"gear"`
	Cybernetics      ItemGrid[NamedDescription] `json:"cybernetics"`
	Experience       Experience                 `json:"experience" validate:"required"`
	Mutations        ItemGrid[NamedDescription] `json:"mutations"`
	MentalDisorders  ItemGrid[NamedDescription] `json:"mental-disorders"`
	Diseases         ItemGrid[NamedDescription] `json:"diseases"`
	Psykana          Psykana                    `json:"psykana" validate:"required"`
	TechnoArcana     TechnoArcana               `json:"techno-arcana"`
}

type ItemGrid[T any] struct {
	Items   map[string]T        `json:"items"`
	Layouts map[string]Position `json:"layouts"`
}

type CharacterInfo struct {
	CharacterName string `json:"character-name" validate:"required"`
	Archetype     string `json:"archetype"`
	Race          string `json:"race"`
	WarbandName   string `json:"warband-name"`
	Pride         string `json:"pride"`
	Homeworld     string `json:"homeworld"`
	Origin        string `json:"origin"`
	Gender        string `json:"gender"`
	Age           string `json:"age"`
	Complexion    string `json:"complexion"`
	Disgrace      string `json:"disgrace"`
	Motivation    string `json:"motivation"`
}

type Characteristic struct {
	Value     string `json:"value"`
	Unnatural string `json:"unnatural,omitempty"`

	TempValue     string `json:"temp-value,omitempty"`
	TempUnnatural string `json:"temp-unnatural,omitempty"`
	TempEnabled   bool   `json:"temp-enabled"`
}

type Skill struct {
	Name           string `json:"name,omitempty"`
	Characteristic string `json:"characteristic"`
	Plus0          bool   `json:"+0,omitempty"`
	Plus10         bool   `json:"+10,omitempty"`
	Plus20         bool   `json:"+20,omitempty"`
	Plus30         bool   `json:"+30,omitempty"`
	MiscBonus      int    `json:"misc-bonus,omitempty"`
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

type ResourceTracker struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

type Movement struct {
	MoveHalf   int `json:"move_half"`
	MoveFull   int `json:"move_full"`
	MoveCharge int `json:"move_charge"`
	MoveRun    int `json:"move_run"`
}

type Armour struct {
	Head                         BodyPart `json:"head"`
	LeftArm                      BodyPart `json:"left-arm"`
	Body                         BodyPart `json:"body"`
	RightArm                     BodyPart `json:"right-arm"`
	LeftLeg                      BodyPart `json:"left-leg"`
	RightLeg                     BodyPart `json:"right-leg"`
	WoundsMax                    int      `json:"wounds_max"`
	WoundsCur                    int      `json:"wounds_cur"`
	ToughnessBaseAbsorptionValue int      `json:"toughness-base-absorption-value"`
	NaturalArmourValue           int      `json:"natural-armor-value"`
	MachineValue                 int      `json:"machine-value"`
	DaemonicValue                int      `json:"demonic-value"`
	OtherArmourValue             int      `json:"other-armour-value"`
}

type BodyPart struct {
	ArmourValue int    `json:"armour-value"`
	Extra1Name  string `json:"extra1-name"`
	Extra1Value int    `json:"extra1-value"`
	Extra2Name  string `json:"extra2-name"`
	Extra2Value int    `json:"extra2-value"`
	SuperArmour int    `json:"superarmour"`
}

type PowerShield struct {
	Name        string `json:"name"`
	Rating      string `json:"rating"`
	Nature      string `json:"nature"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type RangedAttack struct {
	Name        string `json:"name"`
	Class       string `json:"class"`
	Range       string `json:"range"`
	Damage      string `json:"damage"`
	Pen         string `json:"pen"`
	DamageType  string `json:"damage-type"`
	RoFSingle   string `json:"rof-single"`
	RoFShort    string `json:"rof-short"`
	RoFLong     string `json:"rof-long"`
	ClipCur     string `json:"clip-cur"`
	ClipMax     string `json:"clip-max"`
	Reload      string `json:"reload"`
	Special     string `json:"special"`
	Upgrades    string `json:"upgrades"`
	Description string `json:"description"`
}

type MeleeAttack struct {
	Name        string             `json:"name"`
	Group       string             `json:"group"`
	Grip        string             `json:"grip"`
	Balance     string             `json:"balance"`
	Upgrades    string             `json:"upgrades"`
	Tabs        ItemGrid[MeleeTab] `json:"tabs"`
	Description string             `json:"description"`
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
	Alignment string                   `json:"alignment"`
	Aptitudes string                   `json:"aptitudes"`
	Total     int                      `json:"experience-total"`
	Spent     int                      `json:"experience-spent"`
	Remaining int                      `json:"experience-remaining"`
	Log       ItemGrid[ExperienceItem] `json:"experience-log"`
}

type ExperienceItem struct {
	Name           string `json:"name"`
	ExperienceCost int    `json:"experience-cost"`
}

type Psykana struct {
	PsykanaType     string                 `json:"psykana-type"`
	MaxPush         int                    `json:"max-push"`
	BasePR          int                    `json:"base-pr"`
	SustainedPowers int                    `json:"sustained-powers"`
	EffectivePR     int                    `json:"effective-pr"`
	PsychicPowers   ItemGrid[PsychicPower] `json:"psychic-powers"`
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

type TechnoArcana struct {
	CurrentCognition int                 `json:"current-cognition"`
	MaxCognition     int                 `json:"max-cognition"`
	RestoreCognition int                 `json:"restore-cognition"`
	CurrentEnergy    int                 `json:"current-energy"`
	MaxEnergy        int                 `json:"max-energy"`
	TechPowers       ItemGrid[TechPower] `json:"tech-powers"`
}

type TechPower struct {
	Name        string `json:"name"`
	Subtypes    string `json:"subtypes"`
	Range       string `json:"range"`
	Test        string `json:"test"`
	Implants    string `json:"implants"`
	Price       string `json:"price"`
	Process     string `json:"process"`
	Action      string `json:"action"`
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
	ColIndex int `json:"colIndex" validate:"gte=0"`
	RowIndex int `json:"rowIndex" validate:"gte=0"`
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
  "initiative": "d10+0",
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
  }
}`

func ValidateCharacterSheetJSON(jsonData json.RawMessage) error {
	var content CharacterSheetContent

	if err := json.Unmarshal(jsonData, &content); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}

	validate := validator.New()
	if err := validate.Struct(content); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	return nil
}

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

func (m *CharacterSheetModel) ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error) {
	const stmt = `
        UPDATE character_sheets
        SET sheet_visibility = $1::sheet_visibility,
            version = version + 1,
            updated_at = now()
        WHERE id = $2
          AND owner_id = $3
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, visibility, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
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

func replaceLastSegment(path []string, from, to string) ([]string, error) {
	result := make([]string, len(path))
	copy(result, path)

	found := false
	for i := len(result) - 1; i >= 0; i-- {
		if result[i] == from {
			result[i] = to
			found = true
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("segment '%s' not found in path", from)
	}

	return result, nil
}

// Create object at JSON path and corresponding Layout object, set it's content if provided
// - path: container path parts (e.g. {"melee-attack"} or {"melee-attack","melee-attack-XYZ","tabs"})
func (m *CharacterSheetModel) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error) {
	// Construct item path: path + itemID
	itemPath := append(append([]string(nil), path...), itemID)
	// ["custom-skills", "items", "skill-1"]

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// ["custom-skills", "layouts", "skill-1"]

	// Always do two jsonb_set operations (create item + set position)
	const q = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_set(
                jsonb_ensure_path(content, $1::text[]),
                $1::text[], $2::jsonb, true
            ),
            $3::text[], $4::jsonb, true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $6 AND can_edit_character_sheet($5, $6)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, q, itemPath, init, layoutPath, pos, userID, sheetID).Scan(&version)

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
	// Use jsonb_ensure_path to create all parent objects if they don't exist
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
            $1::text[], 
            $2::jsonb, 
            true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, path, newValueJSON, sheetID, userID).Scan(&version)

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
	// Merge semantics: ensure path exists, then merge changes into it
	// coalesce(content #> path, '{}'::jsonb) || $2::jsonb
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
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
func (m *CharacterSheetModel) ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]Position) (int, error) {
	// path is now ["custom-skills", "layouts"] - already complete

	layoutPath, err := replaceLastSegment(path, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}

	var valB []byte
	if positions == nil {
		valB = []byte(`{}`)
	} else {
		valB, err = json.Marshal(positions)
		if err != nil {
			return 0, err
		}
	}

	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
            $1::text[], 
			$2::jsonb, 
			true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3 AND can_edit_character_sheet($4, $3)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, stmt, layoutPath, string(valB), sheetID, userID).Scan(&version)

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

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// layoutPath is now ["custom-skills", "layouts", "skill-1"]

	const query = `
        UPDATE character_sheets
        SET content = (content #- $1::text[]) #- $2::text[],
            version = version + 1,
            updated_at = now()
        WHERE id = $3 AND can_edit_character_sheet($4, $3)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, query, itemPath, layoutPath, sheetID, userID).Scan(&version)

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
	CanView        bool
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
            cs.sheet_visibility,
			can_view_character_sheet($1, cs.id) AS can_view,
            can_edit_character_sheet($1, cs.id) AS can_edit
        FROM character_sheets cs
        WHERE cs.id = $2
    `

	row := m.DB.QueryRow(ctx, stmt, userID, sheetID)

	s := &CharacterSheet{}
	var canView, canEdit bool

	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
		&s.Visibility,
		&canView,
		&canEdit,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	// Check if user has view permission
	if !canView {
		return nil, ErrPermissionDenied
	}

	return &CharacterSheetView{
		CharacterSheet: s,
		CanView:        canView,
		CanEdit:        canEdit,
	}, nil
}
