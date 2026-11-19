package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
)

// The gamemaster's encounter that scripts/perf/stress.mjs types into: more
// creatures than a big fight has, in groups of both columns, each a small
// sheet. A scenario picks a creature by its name (Stress Ork 01…).
const stressEncounterName = "Stress encounter"

type stressSquad struct {
	Name, Creature, Side string
	Count                int
}

var stressSquads = []stressSquad{
	{Name: "Boyz", Creature: "Stress Ork", Side: models.SideEnemies, Count: 10},
	{Name: "Gretchin", Creature: "Stress Grot", Side: models.SideEnemies, Count: 8},
	{Name: "Militia", Creature: "Stress Militiaman", Side: models.SideParty, Count: 6},
}

// ensureStressEncounter makes the encounter anew in the room, as the
// gamemaster loads a file: the one from the last seed goes with its NPCs and
// whatever the measurements typed into them.
func ensureStressEncounter(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int, gm *seedUser) (int, error) {
	if _, err := db.Exec(ctx, `DELETE FROM encounters WHERE room_id = $1 AND name = $2`, roomID, stressEncounterName); err != nil {
		return 0, fmt.Errorf("stress encounter: %w", err)
	}
	data, err := json.Marshal(stressEncounterFile())
	if err != nil {
		return 0, err
	}
	f, err := models.ParseEncounterFile(data)
	if err != nil {
		return 0, fmt.Errorf("stress encounter file: %w", err)
	}
	state, err := m.Encounters.Load(ctx, gm.ID, roomID, f, i18n.Default)
	if err != nil {
		return 0, fmt.Errorf("stress encounter: %w", err)
	}
	return state.ID, nil
}

func stressEncounterFile() models.EncounterFile {
	f := models.EncounterFile{
		Format: models.EncounterFileFormat, Version: models.EncounterFileVersion, Name: stressEncounterName, Round: 1,
		Description: stressText(2),
	}
	for g, squad := range stressSquads {
		ref := fmt.Sprintf("g%d", g+1)
		name := squad.Name
		f.Groups = append(f.Groups, models.GroupInFile{Ref: ref, Name: &name})
		for i := range squad.Count {
			content, err := json.Marshal(stressCreature(fmt.Sprintf("%s %02d", squad.Creature, i+1), g))
			if err != nil {
				panic(err)
			}
			f.Npcs = append(f.Npcs, models.NpcInFile{Group: ref, Side: squad.Side, SheetKind: models.KindBlackCrusade, Content: content})
		}
	}
	return f
}

// stressCreature is a creature of a bestiary: characteristics, wounds, two
// attacks, a talent and a trait.
func stressCreature(name string, squad int) models.CharacterSheetContent {
	characteristics := map[string]models.Characteristic{}
	for i, key := range stressKinds[models.KindBlackCrusade].characteristics {
		characteristics[key] = models.Characteristic{Value: fmt.Sprint(25 + 5*squad + 2*i)}
	}
	ranged := models.NewDefaultRangedAttackRoll()
	ranged.TestOption = stressID("test-option", 0)
	melee := models.NewDefaultMeleeAttackRoll()
	melee.TestOption = stressID("test-option", 0)
	return models.CharacterSheetContent{
		CharacterInfo:   models.CharacterInfo{CharacterName: name},
		Characteristics: characteristics,
		SkillsLeft: map[string]models.Skill{
			"awareness": {Plus0: true}, "dodge": {Plus0: true}, "parry": {Plus0: true, Plus10: squad == 0},
		},
		SkillsRight: map[string]models.Skill{"1_linguistics": {Name: "Linguistics 1", Characteristic: "I", Plus0: true}},
		Fatigue:     models.Fatigue{Threshold: models.ResourceStat{Base: "4"}, FatigueMode: "all"},
		Initiative:  models.InitiativeData{Dice: "d10", ABonus: true},
		Movement: models.Movement{Modes: stressList("mode",
			models.MovementMode{Name: "Land", Spd: "A.b+Size", HalfMult: 1, FullMult: 2, ChargeMult: 3, RunMult: 6},
		)},
		Armour: models.Armour{
			Head: models.BodyPart{ArmourValue: 2}, LeftArm: models.BodyPart{ArmourValue: 2}, Body: models.BodyPart{ArmourValue: 4},
			RightArm: models.BodyPart{ArmourValue: 2}, LeftLeg: models.BodyPart{ArmourValue: 2}, RightLeg: models.BodyPart{ArmourValue: 2},
			WoundsMax: 12 + 2*squad, WoundsCur: 12 + 2*squad,
		},
		RangedAttacks: models.RangedAttacks{TestOptions: stressList("test-option", models.TestOption{Base: "BS"}), List: stressList("ranged", models.RangedAttack{
			Name: "Shoota", Class: "basic", Range: "40m", Damage: "1d10+4", Pen: "0", DamageType: "I",
			RoFSingle: "S", RoFShort: "3", RoFLong: "-", ClipCur: "30", ClipMax: "30", Reload: "2", Roll: ranged,
		})},
		MeleeAttacks: models.MeleeAttacks{TestOptions: stressList("test-option", models.TestOption{Base: "WS"}), List: stressList("melee", models.MeleeAttack{
			Name: "Choppa", Group: "chain", Balance: "0",
			Tabs: stressList("profile", models.MeleeTab{Profile: "choppa", Range: "1m", Damage: "1d10+S.b", Pen: "2", DamageType: "R"}),
			Roll: melee,
		})},
		Talents: models.Talents{List: namedDescriptions("talent", "Talent", 1)},
		Traits:  models.Traits{List: namedDescriptions("trait", "Trait", 1)},
	}
}
