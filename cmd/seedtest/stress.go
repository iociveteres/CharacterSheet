package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"charactersheet.iociveteres.net/internal/models"
)

// The stress sheets that scripts/perf/stress.mjs measures. Stress M is about
// twice the largest real sheet; Stress XL has every list of M four times as
// long, so that the cost of an action on the two shows whether it grows with
// the sheet. Item ids are fixed (custom-skill-01, psy-power-01…): the
// scenarios refer to them, and XL has every item of M.
type stressProfile struct {
	Name  string
	Scale int
}

var stressProfiles = []stressProfile{{Name: "M", Scale: 1}, {Name: "XL", Scale: 4}}

// Power tabs per block; their powers grow with the scale.
const stressPowerTabs = 3

var stressCharacteristics = []string{"WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"}

// ensureStressSheets gives the owner a fresh copy of every stress sheet: the
// copies from the last seed, with whatever the measurements typed into them,
// were deleted by ensureSheet.
func ensureStressSheets(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int, owner *seedUser) (map[string]int, error) {
	ids := map[string]int{}
	for _, p := range stressProfiles {
		content, err := json.Marshal(stressSheet("Stress "+p.Name, p.Scale))
		if err != nil {
			return nil, err
		}
		id, err := m.CharacterSheets.InsertWithContent(ctx, owner.ID, roomID, models.DefaultSheetKind, content)
		if err != nil {
			return nil, fmt.Errorf("stress sheet %s: %w", p.Name, err)
		}
		if _, err := db.Exec(ctx, `UPDATE character_sheets SET sheet_visibility = 'everyone_can_view' WHERE id = $1`, id); err != nil {
			return nil, err
		}
		ids[p.Name] = id
	}
	return ids, nil
}

func stressID(prefix string, i int) string {
	return fmt.Sprintf("%s-%02d", prefix, i+1)
}

// stressGrid has count items dealt into two columns; a one-column grid clamps
// them into its column in the same order.
func stressGrid[T any](prefix string, count int, item func(i int) T) models.ItemGrid[T] {
	g := models.ItemGrid[T]{Items: map[string]T{}, Layouts: map[string]models.Position{}}
	for i := range count {
		id := stressID(prefix, i)
		g.Items[id] = item(i)
		g.Layouts[id] = models.Position{ColIndex: i % 2, RowIndex: i / 2}
	}
	return g
}

const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "

func stressText(sentences int) string {
	return strings.TrimSpace(strings.Repeat(lorem, sentences))
}

func namedDescriptions(prefix, name string, count int) models.ItemGrid[models.NamedDescription] {
	return stressGrid(prefix, count, func(i int) models.NamedDescription {
		return models.NamedDescription{Name: fmt.Sprintf("%s %02d", name, i+1), Description: stressText(1 + i%3)}
	})
}

func stressSheet(name string, n int) models.CharacterSheetContent {
	characteristics := map[string]models.Characteristic{}
	for i, key := range stressCharacteristics {
		c := models.Characteristic{Value: fmt.Sprint(30 + 3*i)}
		if key == "S" || key == "T" {
			c.Unnatural = "2"
		}
		characteristics[key] = c
	}

	skillsLeft := map[string]models.Skill{}
	for i, key := range []string{"acrobatics", "athletics", "awareness", "dodge", "logic", "medicae", "parry", "psyniscience", "scrutiny", "tech-use"} {
		skillsLeft[key] = models.Skill{Plus0: true, Plus10: i%2 == 0, MiscBonus: 5}
	}
	skillsRight := map[string]models.Skill{}
	for _, group := range []struct {
		suffix, name string
		count        int
	}{{"linguistics", "Linguistics", 5}, {"trade", "Trade", 5}, {"common_lore", "Common Lore", 6}, {"scholastic_lore", "Scholastic Lore", 5}, {"forbidden_lore", "Forbidden Lore", 5}} {
		for i := range group.count {
			skillsRight[fmt.Sprintf("%d_%s", i+1, group.suffix)] = models.Skill{
				Name: fmt.Sprintf("%s %d", group.name, i+1), Characteristic: "I", Plus0: true, Plus10: i%2 == 0,
			}
		}
	}

	noEntries := stressGrid("entry", 0, func(int) models.ConditionEntry { return models.ConditionEntry{} })

	return models.CharacterSheetContent{
		CharacterInfo: models.CharacterInfo{
			CharacterName: name, Archetype: "Heretek", Race: "Human", WarbandName: "The Stress Test",
			Pride: "Tenacity", Homeworld: "Forge World", Origin: "Tech-priest", Gender: "Unknown", Age: "212",
			Complexion: "Grey", Disgrace: "Heresy", Motivation: "Knowledge",
		},
		Characteristics: characteristics,
		Conditions: models.Conditions{List: stressGrid("condition", 10*n, func(i int) models.Condition {
			return models.Condition{
				Name: fmt.Sprintf("Condition %02d", i+1), Enabled: i%2 == 0, Stacks: 1,
				Entries: stressGrid("entry", 2, func(j int) models.ConditionEntry {
					if j == 0 {
						return models.ConditionEntry{Type: "char_bonus", Name: stressCharacteristics[i%len(stressCharacteristics)], Bonus: "5"}
					}
					return models.ConditionEntry{Type: "skill_bonus", Name: "Awareness", SkillBonus: "10"}
				}),
			}
		})},
		SkillsLeft:  skillsLeft,
		SkillsRight: skillsRight,
		CustomSkills: models.CustomSkills{List: stressGrid("custom-skill", 10*n, func(i int) models.Skill {
			return models.Skill{
				Name: fmt.Sprintf("Custom Skill %02d", i+1), Characteristic: stressCharacteristics[i%len(stressCharacteristics)],
				Plus0: true, MiscBonus: i % 10,
			}
		})},
		Notes: models.NotesSection{List: stressGrid("note", 20*n, func(i int) models.Note {
			return models.Note{Name: fmt.Sprintf("Note %02d", i+1), Description: stressText(1 + i%3)}
		})},
		InfamyPoints: models.InfamyPoints{InfamyMax: 40, InfamyCur: 25},
		Fatigue:      models.Fatigue{FatigueMax: 4, FatigueCur: 1, FatigueMode: "all"},
		ResourceTrackers: models.ResourceTrackers{List: stressGrid("tracker", 4*n, func(i int) models.ResourceTracker {
			return models.ResourceTracker{Name: fmt.Sprintf("Tracker %02d", i+1), Value: i}
		})},
		Initiative: models.InitiativeData{Dice: "d10", ABonus: true, FlatBonus: 1},
		Movement:   models.Movement{Bonus: 1, FullMult: 2, ChargeMult: 3, RunMult: 6},
		Armour: models.Armour{
			Head: models.BodyPart{ArmourValue: 4}, LeftArm: models.BodyPart{ArmourValue: 4}, Body: models.BodyPart{ArmourValue: 6},
			RightArm: models.BodyPart{ArmourValue: 4}, LeftLeg: models.BodyPart{ArmourValue: 4}, RightLeg: models.BodyPart{ArmourValue: 4},
			WoundsMax: 18, WoundsCur: 12,
		},
		PowerShields: models.PowerShields{List: stressGrid("power-shield", 2*n, func(i int) models.PowerShield {
			return models.PowerShield{Name: fmt.Sprintf("Shield %02d", i+1), Rating: "40", Nature: "tech", Type: "dome", Description: stressText(1)}
		})},
		RangedAttacks: models.RangedAttacks{List: stressGrid("ranged", 5*n, func(i int) models.RangedAttack {
			return models.RangedAttack{
				Name: fmt.Sprintf("Ranged %02d", i+1), Class: "pistol", Range: "30m", Damage: "1d10+4", Pen: "4", DamageType: "E",
				RoFSingle: "S", RoFShort: "3", RoFLong: "-", ClipCur: "20", ClipMax: "30", Reload: "Full",
				Special: "Reliable", Description: stressText(2), Roll: models.NewDefaultRangedAttackRoll(),
			}
		})},
		MeleeAttacks: models.MeleeAttacks{List: stressGrid("melee", 5*n, func(i int) models.MeleeAttack {
			return models.MeleeAttack{
				Name: fmt.Sprintf("Melee %02d", i+1), Group: "power", Grip: "1h", Balance: "0", Description: stressText(2),
				Tabs: stressGrid("profile", 2, func(int) models.MeleeTab {
					return models.MeleeTab{Profile: "sword", Range: "1m", Damage: "1d10+5", Pen: "5", DamageType: "E", Special: "Power Field"}
				}),
				Roll: models.NewDefaultMeleeAttackRoll(),
			}
		})},
		Traits:      models.Traits{List: namedDescriptions("trait", "Trait", 4*n)},
		Talents:     models.Talents{List: namedDescriptions("talent", "Talent", 20*n)},
		CarryWeight: models.CarryWeightAndEncumbrance{CarryWeightBase: 8, Encumbrance: 40, CarryWeight: 45, LiftWeight: 90, PushWeight: 180},
		Gear: models.Gear{List: stressGrid("gear", 30*n, func(i int) models.GearItem {
			item := models.GearItem{
				Name: fmt.Sprintf("Gear %02d", i+1), Weight: 1.5, Description: stressText(1 + i%2),
				GearType: []string{"gear", "tool", "armour", "weapon", "consumable"}[i%5], Carried: true,
				ConditionEntries: noEntries,
			}
			if item.GearType == "armour" {
				item.Equipped = true
				item.Armour = &models.GearArmour{AP: models.GearArmourAP{Head: "4", Torso: "6", Arms: "4", Legs: "4"}}
				item.ConditionEntries = stressGrid("entry", 1, func(int) models.ConditionEntry {
					return models.ConditionEntry{Type: "char_bonus", Name: "S", Bonus: "5"}
				})
			}
			return item
		})},
		Cybernetics: models.Cybernetics{List: stressGrid("cybernetic", 20*n, func(i int) models.CyberneticImplant {
			return models.CyberneticImplant{Name: fmt.Sprintf("Implant %02d", i+1), Description: stressText(1), ConditionEntries: noEntries}
		})},
		Experience: models.Experience{
			Alignment: "Undivided", Aptitudes: "Willpower, Intelligence, Knowledge", Total: 20000, Spent: 10000 * n, Remaining: 10000,
			Log: stressGrid("advance", 40*n, func(i int) models.ExperienceItem {
				return models.ExperienceItem{Name: fmt.Sprintf("Advance %02d", i+1), ExperienceCost: 250, Type: "talent", Level: 1}
			}),
		},
		Mutations:       models.Mutations{List: namedDescriptions("mutation", "Mutation", 4*n)},
		MentalDisorders: models.MentalDisorders{InsanityPoints: 20, List: namedDescriptions("disorder", "Disorder", 4*n)},
		Diseases:        models.Diseases{List: namedDescriptions("disease", "Disease", 2*n)},
		Psykana: models.Psykana{
			PsykanaType: "Bound", MaxPush: 3, BasePR: 4, SustainedPowers: 1, EffectivePR: 3,
			TestOptions: stressTestOptions(8*n, psykanaOption),
			Tabs: stressTabs("psy", 15*n, func(i int) models.PsychicPower {
				return models.PsychicPower{
					Name: fmt.Sprintf("Psychic Power %02d", i+1), Subtypes: "Attack", Range: "10m x PR", Psychotest: "Opposed",
					Action: "Half", Sustained: "No", WeaponRange: "20m", Damage: "1d10+PR", Pen: "PR", DamageType: "E",
					RoFSingle: "S", Effect: stressText(2),
					Roll: &models.PsychicPowerRoll{TestOption: stressID("test-option", i%(8*n))},
				}
			}, func(i int, powers models.ItemGrid[models.PsychicPower]) models.PsychicPowersTab {
				return models.PsychicPowersTab{Name: fmt.Sprintf("Discipline %d", i+1), Powers: powers}
			}),
		},
		TechnoArcana: models.TechnoArcana{
			CurrentCognition: 10, MaxCognition: 20, RestoreCognition: 2, CurrentEnergy: 50, MaxEnergy: 100,
			TestOptions: stressTestOptions(8*n, technoArcanaOption),
			Tabs: stressTabs("tech", 15*n, func(i int) models.TechPower {
				return models.TechPower{
					Name: fmt.Sprintf("Tech Power %02d", i+1), Subtypes: "Attack", Range: "30m", Test: "Tech-Use",
					Implants: "Mechadendrite", Price: "5 energy", Process: "Channel", Action: "Half", WeaponRange: "30m",
					Damage: "2d10", Pen: "2", DamageType: "E(El)", RoFSingle: "S", Effect: stressText(2),
					Roll: &models.TechPowerRoll{TestOption: stressID("test-option", i%(8*n))},
				}
			}, func(i int, powers models.ItemGrid[models.TechPower]) models.TechPowersTab {
				return models.TechPowersTab{Name: fmt.Sprintf("Protocol %d", i+1), Powers: powers}
			}),
		},
	}
}

// stressTabs deals the powers into stressPowerTabs tabs in a row: the first
// tab gets the first ones.
func stressTabs[P, T any](prefix string, powers int, power func(i int) P, tab func(i int, powers models.ItemGrid[P]) T) models.ItemGrid[T] {
	perTab := (powers + stressPowerTabs - 1) / stressPowerTabs
	return stressGrid(prefix+"-tab", stressPowerTabs, func(t int) T {
		g := models.ItemGrid[P]{Items: map[string]P{}, Layouts: map[string]models.Position{}}
		for i := t * perTab; i < min(powers, (t+1)*perTab); i++ {
			id := stressID(prefix+"-power", i)
			g.Items[id] = power(i)
			g.Layouts[id] = models.Position{ColIndex: (i - t*perTab) % 2, RowIndex: (i - t*perTab) / 2}
		}
		return tab(t, g)
	})
}

// stressTestOptions repeats a pattern of eight options; each round names the
// next custom skill and right skill, so that custom-skill-10 and the forbidden
// lores stay without options in both profiles.
func stressTestOptions(count int, option func(i, round int) models.TestOption) models.ItemGrid[models.TestOption] {
	return stressGrid("test-option", count, func(i int) models.TestOption { return option(i%8, i/8) })
}

func psykanaOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "W"}, {Base: "P"}, {Base: "psyniscience"}, {Base: "awareness", Characteristic: "I"},
		{Base: "custom:" + stressID("custom-skill", round)}, {Base: fmt.Sprintf("%d_common_lore", round%6+1)},
		{Base: "Cor"}, {Base: "logic", Characteristic: "W"},
	}[i]
}

func technoArcanaOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "tech-use"}, {Base: "medicae"}, {Base: "awareness", Characteristic: "I"}, {Base: "athletics"},
		{Base: "logic"}, {Base: "custom:" + stressID("custom-skill", round)},
		{Base: fmt.Sprintf("%d_common_lore", round%6+1), Characteristic: "W"}, {Base: "I"},
	}[i]
}
