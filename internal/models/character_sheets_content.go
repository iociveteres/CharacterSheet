package models

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
)

type CharacterSheetContent struct {
	CharacterInfo    CharacterInfo              `json:"characterInfo" validate:"required"`
	Characteristics  map[string]Characteristic  `json:"characteristics" validate:"required"`
	SkillsLeft       map[string]Skill           `json:"skillsLeft" validate:"required"`
	SkillsRight      map[string]Skill           `json:"skillsRight" validate:"required"`
	CustomSkills     ItemGrid[Skill]            `json:"customSkills"`
	Notes            ItemGrid[Note]             `json:"notes"`
	InfamyPoints     InfamyPoints               `json:"infamyPoints" validate:"required"`
	Fatigue          Fatigue                    `json:"fatigue" validate:"required"`
	ResourceTrackers ItemGrid[ResourceTracker]  `json:"resourceTrackers"`
	Initiative       string                     `json:"initiative"`
	Size             int                        `json:"size"`
	Movement         Movement                   `json:"movement" validate:"required"`
	Armour           Armour                     `json:"armour" validate:"required"`
	PowerShields     ItemGrid[PowerShield]      `json:"powerShields"`
	RangedAttacks    ItemGrid[RangedAttack]     `json:"rangedAttacks"`
	MeleeAttacks     ItemGrid[MeleeAttack]      `json:"meleeAttacks"`
	Traits           ItemGrid[NamedDescription] `json:"traits"`
	Talents          ItemGrid[NamedDescription] `json:"talents"`
	CarryWeight      CarryWeightAndEncumbrance  `json:"carryWeightAndEncumbrance" validate:"required"`
	Gear             ItemGrid[GearItem]         `json:"gear"`
	Cybernetics      ItemGrid[NamedDescription] `json:"cybernetics"`
	Experience       Experience                 `json:"experience" validate:"required"`
	Mutations        ItemGrid[NamedDescription] `json:"mutations"`
	MentalDisorders  ItemGrid[NamedDescription] `json:"mentalDisorders"`
	Diseases         ItemGrid[NamedDescription] `json:"diseases"`
	Psykana          Psykana                    `json:"psykana" validate:"required"`
	TechnoArcana     TechnoArcana               `json:"technoArcana"`
}

type ItemGrid[T any] struct {
	Items   map[string]T        `json:"items"`
	Layouts map[string]Position `json:"layouts"`
}

type CharacterInfo struct {
	CharacterName string `json:"characterName" validate:"required"`
	Archetype     string `json:"archetype"`
	Race          string `json:"race"`
	WarbandName   string `json:"warbandName"`
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

	TempValue     string `json:"tempValue,omitempty"`
	TempUnnatural string `json:"tempUnnatural,omitempty"`
	TempEnabled   bool   `json:"tempEnabled"`
}

type Skill struct {
	Name           string `json:"name,omitempty"`
	Characteristic string `json:"characteristic"`
	Plus0          bool   `json:"plus0,omitempty"`
	Plus10         bool   `json:"plus10,omitempty"`
	Plus20         bool   `json:"plus20,omitempty"`
	Plus30         bool   `json:"plus30,omitempty"`
	MiscBonus      int    `json:"miscBonus,omitempty"`
	Difficulty     int    `json:"difficulty,omitempty"`
}

type Note struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type InfamyPoints struct {
	InfamyMax  int `json:"infamyMax"`
	InfamyCur  int `json:"infamyCur"`
	InfamyTemp int `json:"infamyTemp"`
}

type Fatigue struct {
	FatigueMax int `json:"fatigueMax"`
	FatigueCur int `json:"fatigueCur"`
}

type ResourceTracker struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

type Movement struct {
	MoveHalf   int `json:"moveHalf"`
	MoveFull   int `json:"moveFull"`
	MoveCharge int `json:"moveCharge"`
	MoveRun    int `json:"moveRun"`
}

type Armour struct {
	Head                         BodyPart `json:"head"`
	LeftArm                      BodyPart `json:"leftArm"`
	Body                         BodyPart `json:"body"`
	RightArm                     BodyPart `json:"rightArm"`
	LeftLeg                      BodyPart `json:"leftLeg"`
	RightLeg                     BodyPart `json:"rightLeg"`
	WoundsMax                    int      `json:"woundsMax"`
	WoundsCur                    int      `json:"woundsCur"`
	ToughnessBaseAbsorptionValue int      `json:"toughnessBaseAbsorptionValue"`
	NaturalArmourValue           int      `json:"naturalArmourValue"`
	MachineValue                 int      `json:"machineValue"`
	DaemonicValue                int      `json:"daemonicValue"`
	OtherArmourValue             int      `json:"otherArmourValue"`
}

type BodyPart struct {
	ArmourValue int    `json:"armourValue"`
	Extra1Name  string `json:"extra1Name"`
	Extra1Value int    `json:"extra1Value"`
	Extra2Name  string `json:"extra2Name"`
	Extra2Value int    `json:"extra2Value"`
	SuperArmour int    `json:"superArmour"`
}

type PowerShield struct {
	Name        string `json:"name"`
	Rating      string `json:"rating"`
	Nature      string `json:"nature"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type RangedAttack struct {
	Name        string            `json:"name"`
	Class       string            `json:"class"`
	Range       string            `json:"range"`
	Damage      string            `json:"damage"`
	Pen         string            `json:"pen"`
	DamageType  string            `json:"damageType"`
	RoFSingle   string            `json:"rofSingle"`
	RoFShort    string            `json:"rofShort"`
	RoFLong     string            `json:"rofLong"`
	ClipCur     string            `json:"clipCur"`
	ClipMax     string            `json:"clipMax"`
	Reload      string            `json:"reload"`
	Special     string            `json:"special"`
	Upgrades    string            `json:"upgrades"`
	Description string            `json:"description"`
	Roll        *RangedAttackRoll `json:"roll,omitempty"`
}

type MeleeAttack struct {
	Name        string             `json:"name"`
	Group       string             `json:"group"`
	Grip        string             `json:"grip"`
	Balance     string             `json:"balance"`
	Upgrades    string             `json:"upgrades"`
	Tabs        ItemGrid[MeleeTab] `json:"tabs"`
	Description string             `json:"description"`
	Roll        *MeleeAttackRoll   `json:"roll,omitempty"`
}

type MeleeTab struct {
	Profile    string `json:"profile"`
	Range      string `json:"range"`
	Damage     string `json:"damage"`
	Pen        string `json:"pen"`
	DamageType string `json:"damageType"`
	Special    string `json:"special"`
}

type AimColumn struct {
	Selected string `json:"selected"`
	No       int    `json:"no"`
	Half     int    `json:"half"`
	Full     int    `json:"full"`
}

type TargetColumn struct {
	Selected string `json:"selected"`
	No       int    `json:"no"`
	Torso    int    `json:"torso"`
	Leg      int    `json:"leg"`
	Arm      int    `json:"arm"`
	Head     int    `json:"head"`
	Joint    int    `json:"joint"`
	Eyes     int    `json:"eyes"`
}

type RangedRangeColumn struct {
	Selected   string `json:"selected"`
	Melee      int    `json:"melee"`
	PointBlank int    `json:"pointBlank"`
	Short      int    `json:"short"`
	Combat     int    `json:"combat"`
	Long       int    `json:"long"`
	Extreme    int    `json:"extreme"`
}

type RangedRoFColumn struct {
	Selected    string `json:"selected"`
	Single      int    `json:"single"`
	Short       int    `json:"short"`
	Long        int    `json:"long"`
	Suppression int    `json:"suppression"`
}

type MeleeBaseColumn struct {
	Selected string `json:"selected"`
	Standard int    `json:"standard"`
	Charge   int    `json:"charge"`
	Full     int    `json:"full"`
	Careful  int    `json:"careful"`
	Mounted  int    `json:"mounted"`
	Free     int    `json:"free"`
}

type MeleeStanceColumn struct {
	Selected   string `json:"selected"`
	Standard   int    `json:"standard"`
	Aggressive int    `json:"aggressive"`
	Defensive  int    `json:"defensive"`
}

type MeleeRoFColumn struct {
	Selected  string `json:"selected"`
	Single    int    `json:"single"`
	Quick     int    `json:"quick"`
	Lightning int    `json:"lightning"`
}

type RollExtra struct {
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
	Value   int    `json:"value"`
}

type RangedAttackRoll struct {
	Aim        AimColumn         `json:"aim"`
	Target     TargetColumn      `json:"target"`
	Range      RangedRangeColumn `json:"range"`
	RoF        RangedRoFColumn   `json:"rof"`
	Extra1     RollExtra         `json:"extra1"`
	Extra2     RollExtra         `json:"extra2"`
	BaseSelect string            `json:"baseSelect"`
}

type MeleeAttackRoll struct {
	Aim        AimColumn         `json:"aim"`
	Target     TargetColumn      `json:"target"`
	Base       MeleeBaseColumn   `json:"base"`
	Stance     MeleeStanceColumn `json:"stance"`
	RoF        MeleeRoFColumn    `json:"rof"`
	Extra1     RollExtra         `json:"extra1"`
	Extra2     RollExtra         `json:"extra2"`
	BaseSelect string            `json:"baseSelect"`
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
	CarryWeightBase int     `json:"carryWeightBase"`
	Encumbrance     float64 `json:"encumbrance"`
	CarryWeight     float64 `json:"carryWeight"`
	LiftWeight      float64 `json:"liftWeight"`
	PushWeight      float64 `json:"pushWeight"`
}

type Experience struct {
	Alignment string                   `json:"alignment"`
	Aptitudes string                   `json:"aptitudes"`
	Total     int                      `json:"experienceTotal"`
	Spent     int                      `json:"experienceSpent"`
	Remaining int                      `json:"experienceRemaining"`
	Log       ItemGrid[ExperienceItem] `json:"experienceLog"`
}

type ExperienceItem struct {
	Name           string `json:"name"`
	ExperienceCost int    `json:"experienceCost"`
}

type PsychicPowersTab struct {
	Name   string                 `json:"name"`
	Powers ItemGrid[PsychicPower] `json:"powers"`
}

type Psykana struct {
	PsykanaType     string                     `json:"psykanaType"`
	MaxPush         int                        `json:"maxPush"`
	BasePR          int                        `json:"basePR"`
	SustainedPowers int                        `json:"sustainedPowers"`
	EffectivePR     int                        `json:"effectivePR"`
	Tabs            ItemGrid[PsychicPowersTab] `json:"tabs"`
}

type PsychicPower struct {
	Name        string            `json:"name"`
	Subtypes    string            `json:"subtypes"`
	Range       string            `json:"range"`
	Psychotest  string            `json:"psychotest"`
	Action      string            `json:"action"`
	Sustained   string            `json:"sustained"`
	WeaponRange string            `json:"weaponRange"`
	Damage      string            `json:"damage"`
	Pen         string            `json:"pen"`
	DamageType  string            `json:"damageType"`
	RoFSingle   string            `json:"rofSingle"`
	RoFShort    string            `json:"rofShort"`
	RoFLong     string            `json:"rofLong"`
	Special     string            `json:"special"`
	Effect      string            `json:"effect"`
	Roll        *PsychicPowerRoll `json:"roll,omitempty"`
}

type PsychicPowerRoll struct {
	BaseSelect  string    `json:"baseSelect"`
	Modifier    int       `json:"modifier"`
	EffectivePR int       `json:"effectivePR"`
	KickPR      int       `json:"kickPR"`
	Extra1      RollExtra `json:"extra1"`
	Extra2      RollExtra `json:"extra2"`
}

type TechPowersTab struct {
	Name   string              `json:"name"`
	Powers ItemGrid[TechPower] `json:"powers"`
}

type TechnoArcana struct {
	CurrentCognition int                     `json:"currentCognition"`
	MaxCognition     int                     `json:"maxCognition"`
	RestoreCognition int                     `json:"restoreCognition"`
	CurrentEnergy    int                     `json:"currentEnergy"`
	MaxEnergy        int                     `json:"maxEnergy"`
	Tabs             ItemGrid[TechPowersTab] `json:"tabs"`
}

type TechPower struct {
	Name        string         `json:"name"`
	Subtypes    string         `json:"subtypes"`
	Range       string         `json:"range"`
	Test        string         `json:"test"`
	Implants    string         `json:"implants"`
	Price       string         `json:"price"`
	Process     string         `json:"process"`
	Action      string         `json:"action"`
	WeaponRange string         `json:"weaponRange"`
	Damage      string         `json:"damage"`
	Pen         string         `json:"pen"`
	DamageType  string         `json:"damageType"`
	RoFSingle   string         `json:"rofSingle"`
	RoFShort    string         `json:"rofShort"`
	RoFLong     string         `json:"rofLong"`
	Special     string         `json:"special"`
	Effect      string         `json:"effect"`
	Roll        *TechPowerRoll `json:"roll,omitempty"`
}

type TechPowerRoll struct {
	BaseSelect string    `json:"baseSelect"`
	Modifier   int       `json:"modifier"`
	Extra1     RollExtra `json:"extra1"`
	Extra2     RollExtra `json:"extra2"`
}

type Position struct {
	ColIndex int `json:"colIndex" validate:"gte=0"`
	RowIndex int `json:"rowIndex" validate:"gte=0"`
}

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

// Create object at JSON path and corresponding Layout object, set it's content if provided
// - path: container path parts (e.g. {"meleeAttack"} or {"meleeAttack","meleeAttackXYZ","tabs"})
func (m *CharacterSheetModel) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error) {
	// Construct item path: path + itemID
	itemPath := append(append([]string(nil), path...), itemID)
	// ["customSkills", "items", "skill1"]

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// ["customSkills", "layouts", "skill1"]

	// Always do two jsonb_set operations (create item + set position)
	const q = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_set(
                jsonb_ensure_path(content, $1::text[]),
                $1::text[], COALESCE($2::jsonb, '{}'::jsonb), true
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
	// path is now ["customSkills", "layouts"] - already complete

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

func (m *CharacterSheetModel) MoveItemBetweenGrids(
	ctx context.Context,
	userID, sheetID int,
	fromPath, toPath []string,
	itemID string,
	toPos json.RawMessage,
) (int, error) {
	// Begin transaction
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Build full paths including itemID
	fromItemPath := append(append([]string(nil), fromPath...), itemID)
	toItemPath := append(append([]string(nil), toPath...), itemID)

	fromLayoutPath, err := replaceLastSegment(fromItemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid from path: %w", err)
	}

	toLayoutPath, err := replaceLastSegment(toItemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid to path: %w", err)
	}

	// Get the item content before deletion
	const getItemStmt = `
		SELECT content #> $1::text[]
		FROM character_sheets
		WHERE id = $2 AND can_edit_character_sheet($3, $2)
	`
	var itemContent json.RawMessage
	err = tx.QueryRow(ctx, getItemStmt, fromItemPath, sheetID, userID).Scan(&itemContent)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("get item content: %w", err)
	}

	// Delete from source (both item and layout)
	const deleteStmt = `
		UPDATE character_sheets
		SET content = (content #- $1::text[]) #- $2::text[],
			version = version + 1,
			updated_at = now()
		WHERE id = $3 AND can_edit_character_sheet($4, $3)
		RETURNING version
	`
	var intermediateVersion int
	err = tx.QueryRow(ctx, deleteStmt, fromItemPath, fromLayoutPath, sheetID, userID).Scan(&intermediateVersion)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("delete from source: %w", err)
	}

	// Create in destination (both item and layout)
	const createStmt = `
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
		WHERE id = $5 AND can_edit_character_sheet($6, $5)
		RETURNING version
	`
	var finalVersion int
	err = tx.QueryRow(ctx, createStmt, toItemPath, itemContent, toLayoutPath, toPos, sheetID, userID).Scan(&finalVersion)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("create in destination: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return finalVersion, nil
}

// Delete item at JSON path
func (m *CharacterSheetModel) DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error) {
	itemPath := append([]string(nil), path...)

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// layoutPath is now ["customSkills", "layouts", "skill1"]

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
