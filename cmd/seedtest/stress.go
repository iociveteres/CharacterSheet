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
// the sheet. Stress PF is a Pathfinder Crusade sheet of the size of XL, with
// what only that kind has. Item ids are fixed (custom-skill-01, psy-power-01…):
// the scenarios refer to them, and XL has every item of M.
type stressProfile struct {
	Name  string
	Kind  models.SheetKind
	Scale int
}

var stressProfiles = []stressProfile{
	{Name: "M", Kind: models.KindBlackCrusade, Scale: 1},
	{Name: "XL", Kind: models.KindBlackCrusade, Scale: 4},
	{Name: "PF", Kind: models.KindPathfinderCrusade, Scale: 4},
}

// Power tabs per block; their powers grow with the scale.
const stressPowerTabs = 3

// ensureStressSheets gives the owner a fresh copy of every stress sheet: the
// copies from the last seed, with whatever the measurements typed into them,
// were deleted by ensureSheet.
func ensureStressSheets(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int, owner *seedUser) (map[string]int, error) {
	ids := map[string]int{}
	for _, p := range stressProfiles {
		content, err := json.Marshal(stressSheet("Stress "+p.Name, p.Kind, p.Scale))
		if err != nil {
			return nil, err
		}
		id, err := m.CharacterSheets.InsertWithContent(ctx, owner.ID, roomID, p.Kind, content)
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

// stressList is a grid of the given items in their order.
func stressList[T any](prefix string, items ...T) models.ItemGrid[T] {
	return stressGrid(prefix, len(items), func(i int) T { return items[i] })
}

func noEntries() models.ItemGrid[models.ConditionEntry] {
	return stressList[models.ConditionEntry]("entry")
}

func mods(exprs ...string) models.ItemGrid[models.WeaponMod] {
	items := make([]models.WeaponMod, len(exprs))
	for i, e := range exprs {
		items[i] = models.WeaponMod{Expr: e, Enabled: true}
	}
	return stressList("mod", items...)
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

// stressKind is what the kinds differ in that the stress sheet fills: the
// characteristics, the left column of skills and the test options of powers.
type stressKind struct {
	characteristics []string
	skillsLeft      []string
	psykanaOption   func(i, round int) models.TestOption
}

var stressKinds = map[models.SheetKind]stressKind{
	models.KindBlackCrusade: {
		characteristics: []string{"WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"},
		skillsLeft:      []string{"acrobatics", "athletics", "awareness", "dodge", "logic", "medicae", "parry", "psyniscience", "scrutiny", "tech-use"},
		psykanaOption:   psykanaOption,
	},
	models.KindPathfinderCrusade: {
		characteristics: []string{"WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Fa"},
		skillsLeft:      []string{"acrobatics", "athletics", "awareness", "dodge", "logic", "medicae", "parry", "spellcraft", "scrutiny", "tech-use"},
		psykanaOption:   magicOption,
	},
}

// The talents the sheet counts by name (sheet/weapons/talentBonus.ts,
// reloadRules.ts): the first talents of the list.
var stressTalents = []string{"Crushing Blow", "Mighty Shot", "Balearic", "Rapid Reload"}

func stressSheet(name string, kind models.SheetKind, n int) models.CharacterSheetContent {
	k := stressKinds[kind]
	pf := kind == models.KindPathfinderCrusade
	characteristics := map[string]models.Characteristic{}
	for i, key := range k.characteristics {
		c := models.Characteristic{Value: fmt.Sprint(30 + 3*i)}
		if key == "S" || key == "T" {
			c.Unnatural = "2"
		}
		characteristics[key] = c
	}

	skillsLeft := map[string]models.Skill{}
	for i, key := range k.skillsLeft {
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

	gear, weapons := stressGear(n, pf)
	sheet := models.CharacterSheetContent{
		CharacterInfo: models.CharacterInfo{
			CharacterName: name, Archetype: "Heretek", Race: "Human", WarbandName: "The Stress Test",
			Pride: "Tenacity", Homeworld: "Forge World", Origin: "Tech-priest", Gender: "Unknown", Age: "212",
			Complexion: "Grey", Disgrace: "Heresy", Motivation: "Knowledge",
		},
		Characteristics: characteristics,
		Conditions: models.Conditions{List: stressGrid("condition", 10*n, func(i int) models.Condition {
			return models.Condition{
				Name: fmt.Sprintf("Condition %02d", i+1), Enabled: i%2 == 0, Stacks: 1,
				Entries: stressList("entry",
					models.ConditionEntry{Type: "char_bonus", Name: k.characteristics[i%len(k.characteristics)], Bonus: "5"},
					models.ConditionEntry{Type: "skill_bonus", Name: "Awareness", SkillBonus: "10"},
				),
			}
		})},
		SkillsLeft:  skillsLeft,
		SkillsRight: skillsRight,
		CustomSkills: models.CustomSkills{List: stressGrid("custom-skill", 10*n, func(i int) models.Skill {
			return models.Skill{
				Name: fmt.Sprintf("Custom Skill %02d", i+1), Characteristic: k.characteristics[i%len(k.characteristics)],
				Plus0: true, MiscBonus: i % 10,
			}
		})},
		Notes: models.NotesSection{List: stressGrid("note", 20*n, func(i int) models.Note {
			return models.Note{Name: fmt.Sprintf("Note %02d", i+1), Description: stressText(1 + i%3)}
		})},
		InfamyPoints: models.InfamyPoints{InfamyMax: 40, InfamyCur: 25},
		Fatigue:      models.Fatigue{FatigueCur: 1, Threshold: models.ResourceStat{Base: "4"}, FatigueMode: "all"},
		ResourceTrackers: models.ResourceTrackers{List: stressGrid("tracker", 4*n, func(i int) models.ResourceTracker {
			return models.ResourceTracker{Name: fmt.Sprintf("Tracker %02d", i+1), Value: i}
		})},
		Initiative: models.InitiativeData{Dice: "d10", ABonus: true, FlatBonus: 1},
		Movement: models.Movement{Modes: stressList("mode",
			models.MovementMode{Name: "Land", Spd: "A.b+Size+1", HalfMult: 1, FullMult: 2, ChargeMult: 3, RunMult: 6},
			models.MovementMode{Name: "Flight", Spd: "6", HalfMult: 1, FullMult: 2, ChargeMult: 3, RunMult: 6},
		)},
		Armour: models.Armour{
			Head: models.BodyPart{ArmourValue: 4}, LeftArm: models.BodyPart{ArmourValue: 4}, Body: models.BodyPart{ArmourValue: 6},
			RightArm: models.BodyPart{ArmourValue: 4}, LeftLeg: models.BodyPart{ArmourValue: 4}, RightLeg: models.BodyPart{ArmourValue: 4},
			WoundsMax: 18, WoundsCur: 12,
		},
		PowerShields: models.PowerShields{List: stressGrid("power-shield", 2*n, func(i int) models.PowerShield {
			return models.PowerShield{Name: fmt.Sprintf("Shield %02d", i+1), Rating: "40", Nature: "tech", Type: "dome", Description: stressText(1)}
		})},
		RangedAttacks: models.RangedAttacks{
			TestOptions: stressTestOptions(8*n, rangedOption),
			List: stressGrid("ranged", 5*n, func(i int) models.RangedAttack {
				roll := models.NewDefaultRangedAttackRoll()
				roll.TestOption = stressID("test-option", i%(8*n))
				attack := models.RangedAttack{
					Name: fmt.Sprintf("Ranged %02d", i+1), Class: "pistol", Range: "30m", Damage: "1d10+4", Pen: "4", DamageType: "E",
					RoFSingle: "S", RoFShort: "3", RoFLong: "-", ClipCur: "20", ClipMax: "30", Reload: "2",
					Special: "Reliable", Description: stressText(2), Roll: roll,
					DamageMods: mods("1d5", "+1"), PenMods: mods("+1"),
				}
				// Thrown weapons with S.b in their damage, for Balearic.
				if i%5 == 4 {
					attack.Class, attack.Damage = "throwing", "1d5+S.b"
				}
				attack.DamageMods.Items["mod-01"] = models.WeaponMod{Expr: "1d5", Enabled: i%2 == 0}
				if i%2 == 0 {
					attack.Item = weapons[i/2]
				}
				return attack
			}),
		},
		MeleeAttacks: models.MeleeAttacks{
			TestOptions: stressTestOptions(8*n, meleeOption),
			Stance:      "aggressive",
			List: stressGrid("melee", 5*n, func(i int) models.MeleeAttack {
				roll := models.NewDefaultMeleeAttackRoll()
				roll.TestOption = stressID("test-option", i%(8*n))
				attack := models.MeleeAttack{
					Name: fmt.Sprintf("Melee %02d", i+1), Group: "power", Balance: "0", Description: stressText(2),
					Grip: "2h [1h, Cl]", GripSelected: []string{"", "1h", "Cl"}[i%3], ParryMods: mods("+5"),
					Tabs: stressGrid("profile", 2, func(int) models.MeleeTab {
						return models.MeleeTab{
							Profile: "sword", Range: "1m", Damage: "1d10+5", Pen: "5", DamageType: "E", Special: "Power Field",
							DamageMods: mods("½S.b▲"), PenMods: mods("+1"),
						}
					}),
					Roll: roll,
				}
				if i%2 == 0 {
					attack.Item = weapons[3*n+i/2]
				}
				return attack
			}),
		},
		Traits: models.Traits{List: namedDescriptions("trait", "Trait", 4*n)},
		Talents: models.Talents{List: stressGrid("talent", 20*n, func(i int) models.NamedDescription {
			if i < len(stressTalents) {
				return models.NamedDescription{Name: stressTalents[i], Description: stressText(1)}
			}
			return models.NamedDescription{Name: fmt.Sprintf("Talent %02d", i+1), Description: stressText(1 + i%3)}
		})},
		CarryWeight: models.CarryWeightAndEncumbrance{CarryWeightBase: 8, Encumbrance: 40, CarryWeight: 45, LiftWeight: 90, PushWeight: 180},
		Gear:        gear,
		Cybernetics: models.Cybernetics{List: stressGrid("cybernetic", 20*n, func(i int) models.CyberneticImplant {
			return models.CyberneticImplant{Name: fmt.Sprintf("Implant %02d", i+1), Description: stressText(1), ConditionEntries: noEntries()}
		})},
		Experience: models.Experience{
			Alignment: "Undivided", Aptitudes: "Willpower, Intelligence, Knowledge", Total: 20000, Spent: 10000 * n, Remaining: 10000,
			UseAptitudes: pf,
			Log: stressGrid("advance", 40*n, func(i int) models.ExperienceItem {
				return models.ExperienceItem{Name: fmt.Sprintf("Advance %02d", i+1), ExperienceCost: 250, Type: "talent", Level: 1}
			}),
		},
		Mutations:       models.Mutations{List: namedDescriptions("mutation", "Mutation", 4*n)},
		MentalDisorders: models.MentalDisorders{InsanityPoints: 20, List: namedDescriptions("disorder", "Disorder", 4*n)},
		Diseases:        models.Diseases{List: namedDescriptions("disease", "Disease", 2*n)},
		Psykana:         stressPsykana(n, k, pf),
	}
	stances := true
	sheet.Settings.MeleeAttacks.Stances = &stances
	if pf {
		sheet.Mana = &models.Mana{Current: 12, Max: models.ResourceStat{Base: "20"}}
		sheet.Spellcasting = &models.Spellcasting{Arcane: true}
		sheet.Coins = &models.Coins{PP: 2, GP: 120, SP: 40, CP: 300}
		// Pathfinder Crusade has no techno arcana: empty, as a new sheet of the kind.
		sheet.TechnoArcana = models.TechnoArcana{
			TestOptions: stressTestOptions(0, technoArcanaOption),
			Tabs:        stressGrid("tech-tab", 0, func(int) models.TechPowersTab { return models.TechPowersTab{} }),
		}
	} else {
		sheet.TechnoArcana = stressTechnoArcana(n)
	}
	return sheet
}

// stressGear is the gear list and the ids of its weapons, which half the
// attacks are linked to. Of every five items one is armour, worn, and one a
// weapon. Every tenth item is worn and has entries, among them a weapon
// entry for the Reload; the fifth of each ten has entries but is not worn, to
// be put on. A weapon has a Quality, an entry for the attacks linked to it
// and, but for the first one (gear-04), a mod that changes its weight; in
// Pathfinder Crusade also a material and every other one an enchantment.
func stressGear(n int, pf bool) (models.Gear, []string) {
	var weapons []string
	weaponIndex := 0
	list := stressGrid("gear", 30*n, func(i int) models.GearItem {
		item := models.GearItem{
			Name: fmt.Sprintf("Gear %02d", i+1), Weight: 1.5, Description: stressText(1 + i%2),
			GearType: []string{"gear", "tool", "armour", "weapon", "consumable"}[i%5], Carried: true,
			ConditionEntries: noEntries(),
		}
		switch {
		case i%10 == 0:
			item.Equipped = true
			item.ConditionEntries = stressList("entry",
				models.ConditionEntry{Type: "skill_bonus", Name: "Dodge", SkillBonus: "5"},
				models.ConditionEntry{Type: "weapon_bonus", Name: "Ranged", WeaponField: "reload", WeaponBonus: "-1"},
			)
		case i%10 == 5:
			item.ConditionEntries = stressList("entry", models.ConditionEntry{Type: "char_bonus", Name: "A", Bonus: "5"})
		case item.GearType == "armour":
			item.Equipped = true
			item.Quality = []string{"", "Good", "Best", "Poor"}[i/5%4]
			item.Armour = &models.GearArmour{
				AP:   models.GearArmourAP{Head: "4", Torso: "6", Arms: "4", Legs: "4"},
				Mods: stressList("mod", models.GearMod{Name: "Sealed", Weight: 1, ConditionEntries: noEntries()}),
			}
			item.ConditionEntries = stressList("entry", models.ConditionEntry{Type: "char_bonus", Name: "S", Bonus: "5"})
			if pf {
				item.Material = &models.GearMaterial{Name: "Mithral", WeightFactor: 0.5, AP: 1, Short: "+20 Max.A", ConditionEntries: noEntries()}
			}
		case item.GearType == "weapon":
			j := weaponIndex
			weaponIndex++
			weapons = append(weapons, stressID("gear", i))
			item.Quality = []string{"Good", "Best", "Poor", ""}[j%4]
			item.Weapon = &models.GearWeapon{Mods: stressList[models.GearWeaponMod]("mod")}
			item.ConditionEntries = stressList("entry",
				models.ConditionEntry{Type: "weapon_bonus", Name: "This item", WeaponField: "dmg", WeaponBonus: "1"},
				models.ConditionEntry{Type: "weapon_bonus", Name: "This item", WeaponField: "hit", WeaponBonus: "5"},
			)
			if j == 0 {
				break
			}
			heavier := 1.5
			item.Weapon.Mods = stressList("mod", models.GearWeaponMod{
				Name: "Weighted", Weight: 0.5, WeightFactor: &heavier,
				ConditionEntries: stressList("entry", models.ConditionEntry{Type: "weapon_bonus", Name: "This item", WeaponField: "pen", WeaponBonus: "1"}),
			})
			if pf {
				item.Material = &models.GearMaterial{Name: "Cold Iron", WeightFactor: 1, Pen: 1, ConditionEntries: noEntries()}
				item.Inlay = "Ruby"
				if j%2 == 1 {
					enchantments := stressList("enchantment", models.GearEnchantment{
						Name: "Keen", Level: "level-01", Capacity: 1, Special: "Keen", ConditionEntries: noEntries(),
						Levels: stressList("level", models.GearEnchantmentLevel{Capacity: 1, Special: "Keen", ConditionEntries: noEntries()}),
					})
					item.Enchantments = &enchantments
				}
			}
		}
		return item
	})
	return models.Gear{List: list}, weapons
}

// stressPsykana: every fifth power is sustained, every tenth of them by Cycle;
// in Pathfinder Crusade every third spell is prepared.
func stressPsykana(n int, k stressKind, pf bool) models.Psykana {
	psykanaType := "Bound"
	if pf {
		psykanaType = "Arcane"
	}
	return models.Psykana{
		PsykanaType: psykanaType, MaxPush: 3, BasePR: 4, SustainedPowers: 1, EffectivePR: 3,
		TestOptions: stressTestOptions(8*n, k.psykanaOption),
		Tabs: stressTabs("psy", 15*n, func(i int) models.PsychicPower {
			power := models.PsychicPower{
				Name: fmt.Sprintf("Psychic Power %02d", i+1), Subtypes: "Attack", Range: "10m x PR", Psychotest: "Opposed",
				Action: "Half", Sustained: "No", WeaponRange: "20m", Damage: "1d10+PR", Pen: "PR", DamageType: "E",
				RoFSingle: "S", Effect: stressText(2),
				DamageMods: mods("PR"), PenMods: mods("+1"),
				Roll:     &models.PsychicPowerRoll{TestOption: stressID("test-option", i%(8*n))},
				Prepared: pf && i%3 == 0,
			}
			if i%5 == 0 {
				power.Sustained = "Yes"
				power.Sustain = models.PsychicPowerSustain{Copies: 1, PR: 3, Free: i%10 == 0}
			}
			return power
		}, func(i int, powers models.ItemGrid[models.PsychicPower]) models.PsychicPowersTab {
			return models.PsychicPowersTab{Name: fmt.Sprintf("Discipline %d", i+1), Powers: powers}
		}),
	}
}

func stressTechnoArcana(n int) models.TechnoArcana {
	return models.TechnoArcana{
		CurrentCognition: 10, CognitionMax: models.ResourceStat{Base: "20"}, CurrentEnergy: 50, EnergyMax: models.ResourceStat{Base: "100"},
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

// magicOption is psykanaOption of Pathfinder Crusade, whose spells test on
// the caster's Spellcasting ("cast") or Spellcraft and which has no Corruption.
func magicOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "cast"}, {Base: "P"}, {Base: "spellcraft"}, {Base: "awareness", Characteristic: "I"},
		{Base: "custom:" + stressID("custom-skill", round)}, {Base: fmt.Sprintf("%d_common_lore", round%6+1)},
		{Base: "Fa"}, {Base: "logic", Characteristic: "W"},
	}[i]
}

func rangedOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "BS"}, {Base: "I"}, {Base: "P"}, {Base: "acrobatics"}, {Base: "medicae", Characteristic: "BS"},
		{Base: "custom:" + stressID("custom-skill", round)}, {Base: fmt.Sprintf("%d_common_lore", round%6+1)}, {Base: "F"},
	}[i]
}

func meleeOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "WS"}, {Base: "I"}, {Base: "W"}, {Base: "athletics"}, {Base: "medicae", Characteristic: "WS"},
		{Base: "custom:" + stressID("custom-skill", round)}, {Base: fmt.Sprintf("%d_common_lore", round%6+1), Characteristic: "WS"}, {Base: "F"},
	}[i]
}

func technoArcanaOption(i, round int) models.TestOption {
	return []models.TestOption{
		{Base: "tech-use"}, {Base: "medicae"}, {Base: "awareness", Characteristic: "I"}, {Base: "athletics"},
		{Base: "logic"}, {Base: "custom:" + stressID("custom-skill", round)},
		{Base: fmt.Sprintf("%d_common_lore", round%6+1), Characteristic: "W"}, {Base: "I"},
	}[i]
}
