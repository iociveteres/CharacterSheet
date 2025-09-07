package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userID int) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userID int) ([]*CharacterSheet, error)
	SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error)
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
	CharacterInfo   CharacterInfo               `json:"character_info"`
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
	CharacterName string `json:"character_name"`
	Archetype     string `json:"archetype"`
	Race          string `json:"race"`
	WarbandName   string `json:"warband_name"`
	Pride         string `json:"pride"`
	Gender        string `json:"gender"`
	Age           string `json:"age"`
	Complexion    string `json:"complexion"`
	Disgrace      string `json:"disgrace"`
	Motivation    string `json:"motivation"`
}

type Characteristic struct {
	Value     int `json:"value"`
	Unnatural int `json:"unnatural,omitempty"`
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
	NaturalArmorValue            int `json:"natural-armor-value"`
	MachineValue                 int `json:"machine-value"`
	DemonicValue                 int `json:"demonic-value"`
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
	Profile  string              `json:"profile"`
	Tabs     map[string]MeleeTab `json:"-"`
	// to capture "melee-attack-1__tab-1" dynamic keys, decode into raw and handle if needed
}

type MeleeTab struct {
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
	Name        string `json:"name"`
	Weight      int    `json:"weight"`
	Description string `json:"description"`
}

type CarryWeightAndEncumbrance struct {
	CarryWeightBase int `json:"carry-weight-base"`
	Encumbrance     int `json:"encumbrance"`
	CarryWeight     int `json:"carry-weight"`
	LiftWeight      int `json:"lift-weight"`
	PushWeight      int `json:"push-weight"`
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

type Layout struct {
	Positions map[string]Position `json:"positions,omitempty"`
}

type Layouts struct {
	CustomSkills    *Layout `json:"custom-skills,omitempty"`
	Notes           *Layout `json:"notes,omitempty"`
	RangedAttacks   *Layout `json:"ranged-attack,omitempty"`
	MeleeAttacks    *Layout `json:"melee-attack,omitempty"`
	Traits          *Layout `json:"traits,omitempty"`
	Talents         *Layout `json:"talents,omitempty"`
	Gear            *Layout `json:"gear,omitempty"`
	Cybernetics     *Layout `json:"cybernetics,omitempty"`
	ExperienceLog   *Layout `json:"experience-log,omitempty"`
	Mutations       *Layout `json:"mutations,omitempty"`
	MentalDisorders *Layout `json:"mental-disorders,omitempty"`
	Diseases        *Layout `json:"diseases,omitempty"`
	PsychicPowers   *Layout `json:"psychic-powers,omitempty"`
}

const defaultContent = `{
  "character_info": {},
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
  "experience": {},
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {},
  "layouts": {
    "custom-skills": { "positions": {} },
    "notes": { "positions": {} },
    "ranged-attack": { "positions": {} },
    "melee-attack": { "positions": {} },
    "traits": { "positions": {} },
    "talents": { "positions": {} },
    "gear": { "positions": {} },
    "cybernetics": { "positions": {} },
    "experience-log": { "positions": {} },
    "mutations": { "positions": {} },
    "mental-disorders": { "positions": {} },
    "diseases": { "positions": {} },
    "psychic-powers": { "positions": {} }
  }
}`

func (m *CharacterSheetModel) Insert(ctx context.Context, userID int) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, content, created_at, updated_at)
VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP))
RETURNING id`

	var id int
	// QueryRow will run the INSERT and scan the returned id
	err := m.DB.QueryRow(ctx, stmt, userID, defaultContent).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character_name' AS character_name, 
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
		content->'character-info'->>'character_name' AS character_name, 
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
  cs.content->'character-info'->>'character_name' AS character_name,
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

var ErrNoContent = errors.New("character sheet has no content")

func (m *CharacterSheet) UnmarshalContent() (*CharacterSheetContent, error) {
	if len(m.Content) == 0 {
		return nil, ErrNoContent
	}

	var content CharacterSheetContent
	if err := json.Unmarshal(m.Content, &content); err != nil {
		return nil, fmt.Errorf("unmarshal character sheet content: %w", err)
	}

	return &content, nil
}
