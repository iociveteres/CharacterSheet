// The words of a roll label (rollLabel.ts) in the reader's language: the
// registry of codes. A code it doesn't know shows its value, so a code dropped
// from the registry still reads as something; to rename one, alias it in
// ALIASES. parseLabel checks what internal/roomws/rolllabel.go checks, on the
// shared examples of internal/roomws/testdata/roll_labels.json.
import { t } from "../i18n";
import { kindOf } from "./kinds";
import { MOD, NAME, SPACE, SRC, WRAP, type Label, type Params, type Part } from "./rollLabel";
import { columnCode, MELEE_PROFILES, MELEE_ROLL_COLUMNS, optionValue, RANGED_ROLL_COLUMNS, type RollColumn, type SkillRow } from "./schema/constants";
import { GRIP_KEYS, GRIP_SHORT, type GripKey } from "./weapons/gripRules";
import { STANCES } from "./weapons/stanceRules";
import { profileName } from "./weapons/melee";
import { qualityName, type Quality } from "./gear/quality";
import { signed } from "./components/format";

/**
 * The entry of `table` named `key`, none for a name only its prototype has:
 * a stored label is anyone's, and "constructor" passes the code mask.
 */
const own = <T>(table: { readonly [key: string]: T }, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The words of `<space>:<value>`; null for a value the space doesn't know. */
type Words = (value: string, params: Params, kind: string | undefined) => string | null;

/** A parameter as it goes into a phrase: a number as it is, a part in words. */
function param(params: Params, name: string, kind: string | undefined): string | number {
    const value = params[name];
    return typeof value === "number" ? value : value === undefined ? "" : partText(value, kind);
}

/** The definition of the label's kind: a label without one is of Black Crusade. */
const kindDef = (kind: string | undefined) => kindOf(kind ?? "black_crusade");

const NAMES: Record<string, (kind: string | undefined) => string | null> = {
    [NAME.unknown]: () => t("common.unknown"),
    [NAME.initiative]: () => t("sheet.terms.stat.initiative"),
    [NAME.unknownPower]: kind => kindDef(kind)?.terms.unknownPower ?? null,
    [NAME.psychicPower]: kind => kindDef(kind)?.terms.psychicPower ?? null,
    [NAME.techPower]: () => t("sheet.termsPowers.tech.techPower"),
    [NAME.unknownTechPower]: () => t("sheet.tech.roll.unknownPower"),
    [NAME.deletedTechPower]: () => t("sheet.tech.deletedPower"),
    [NAME.rangedAttack]: () => t("sheet.weapons.rangedAttack"),
    [NAME.meleeAttack]: () => t("sheet.weapons.meleeAttack"),
    [NAME.phenomena]: () => t("sheet.magic.phenomena.label"),
    [NAME.compensator]: () => t("sheet.termsPowers.techType.compensator"),
};

const MODS: Record<string, (params: Params, kind: string | undefined) => string> = {
    [MOD.safe]: () => t("sheet.magic.roll.safe"),
    [MOD.effectivePR]: (p, kind) => t("sheet.magic.roll.effectivePR", { pr: param(p, "pr", kind) }),
    [MOD.kick]: (p, kind) => t("sheet.magic.roll.kick", { kick: param(p, "kick", kind) }),
    [MOD.twoSustained]: () => t("sheet.magicPf.artsRoll.twoSustained"),
    [MOD.parry]: () => t("sheet.termsSkills.skill.parry"),
};

// The tables below are the sheet's own, whose words are taken when their
// modules load: the page's language is fixed, and so the reader's.

/** The roll columns by the namespace of their codes; the ranged and melee ones share aim and target. */
const COLUMNS = new Map<string, RollColumn>([...RANGED_ROLL_COLUMNS, ...MELEE_ROLL_COLUMNS].map(c => [columnCode(c), c]));

/** A grip is its keys joined by "+", each worded as the chip writes it (gripRules.ts gripText). */
function gripWords(value: string): string | null {
    const keys = value.split("+");
    return keys.every(key => GRIP_KEYS.includes(key as GripKey)) ? keys.map(key => GRIP_SHORT[key as GripKey]).join("+") : null;
}

const STANCE = new Map(STANCES.map(s => [s.key as string, s]));
const STANCE_SOURCE = `${SRC.stance}.`;

/** What the sheet calls a source that has no name of its own, or a stance by its full name. */
function sourceWords(value: string): string | null {
    if (value === SRC.condition) return t("sheet.weapons.condition");
    if (value === SRC.item) return t("sheet.gear.item");
    return value.startsWith(STANCE_SOURCE) ? STANCE.get(value.slice(STANCE_SOURCE.length))?.source ?? null : null;
}

/** A row of the skill table of the label's kind, by its key. */
function skillRow(value: string, kind: string | undefined): SkillRow | undefined {
    const stats = kindDef(kind)?.stats;
    return stats && [...stats.skillsLeft, ...stats.skillsRight].find(row => row.key === value);
}

const PROFILES = new Set(MELEE_PROFILES.map(optionValue));
const QUALITIES = new Set<string>(["Poor", "Common", "Good", "Best"] satisfies Quality[]);

const SPACES: Record<string, Words> = {
    [SPACE.name]: (value, _, kind) => own(NAMES, value)?.(kind) ?? null,
    [SPACE.mod]: (value, params, kind) => own(MODS, value)?.(params, kind) ?? null,
    // In lower case: they follow the roll's name inside the phrase.
    ...Object.fromEntries([...COLUMNS].map(([space, column]) => [space, (value: string) => own(column.names, value)?.toLowerCase() ?? null])),
    [SPACE.grip]: gripWords,
    [SPACE.stance]: value => STANCE.get(value)?.name ?? null,
    [SPACE.profile]: value => (value && value !== "no" && PROFILES.has(value) ? profileName(value) : null),
    [SPACE.quality]: value => (QUALITIES.has(value) ? qualityName(value as Quality) : null),
    [SPACE.src]: sourceWords,
    [SPACE.char]: (value, _, kind) => kindDef(kind)?.stats.characteristics.find(c => c.key === value)?.label ?? null,
    [SPACE.skill]: (value, _, kind) => skillRow(value, kind)?.label ?? null,
    [SPACE.skillGroup]: (value, _, kind) => skillRow(value, kind)?.groupLabel ?? null,
    // What adds to the roll, by its source: "Aggressive stance +10".
    [SPACE.hit]: (_, params, kind) => `${param(params, "s", kind)} ${signed(Number(params.n ?? 0))}`,
    // A line a gear item gives the weapon: its source, and the item unless the item is the source (itemLinkRules.ts linkedLabel).
    [SPACE.linked]: (_, params, kind) => {
        const source = String(param(params, "s", kind));
        const item = String(param(params, "i", kind));
        return source === item ? source : `${source} (${item})`;
    },
};

/** Codes that were renamed or merged: old code → the code it reads as now. */
const ALIASES: Record<string, string> = {};

/** The space and the value of a code, through its alias. */
function split(code: string): [space: string, value: string] {
    const name = own(ALIASES, code) ?? code;
    const colon = name.indexOf(":");
    return colon < 0 ? [name, ""] : [name.slice(0, colon), name.slice(colon + 1)];
}

/** The words of a code; null when no space knows it. */
export function codeWords(code: string, params: Params, kind: string | undefined): string | null {
    const [space, value] = split(code);
    return own(SPACES, space)?.(value, params, kind) ?? null;
}

/** The words of a code; a code no space knows shows its value, or itself without one. */
function codeText(code: string, params: Params, kind: string | undefined): string {
    const [space, value] = split(code);
    return codeWords(code, params, kind) ?? (value || space);
}

function partText(part: Part, kind: string | undefined): string {
    return typeof part === "string" ? part : codeText(part[0], part[1] ?? {}, kind);
}

const WRAPPERS: Record<string, (text: string) => string> = {
    [WRAP.broken]: text => t("sheet.weapons.link.brokenRoll", { label: text }),
};

/** The label in the reader's language: `n (t, t), m, m`, in its wrapper if it has one. */
export function labelText(label: Label): string {
    const words = (p: Part) => partText(p, label.k);
    const name = label.t?.length ? `${words(label.n)} (${label.t.map(words).join(", ")})` : words(label.n);
    const text = label.m?.length ? `${name}, ${label.m.map(words).join(", ")}` : name;
    return (label.w && own(WRAPPERS, label.w)?.(text)) || text;
}

/** Whether the label has anything to word in the reader's language; one without is sent as text alone. */
export function hasCodes(label: Label): boolean {
    return !!label.w || [label.n, ...(label.t ?? []), ...(label.m ?? [])].some(p => typeof p !== "string");
}

// — Checking stored labels ———————————————————

// The limits of internal/roomws/rolllabel.go.
const MAX_PARTS = 64;
const MAX_DEPTH = 3;
const MAX_TEXT = 200;
const MAX_BYTES = 2048;
const CODE = /^[A-Za-z]+(:[A-Za-z0-9_.+\-]+)?$/;
const NAME_RE = /^[A-Za-z]+$/;
const LABEL_KEYS = new Set(["n", "t", "m", "w", "k"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Counts the parts of `part` into `count`; false when it is no part or breaks a limit. */
function validPart(part: unknown, depth: number, count: { parts: number }): boolean {
    if (++count.parts > MAX_PARTS) return false;
    if (typeof part === "string") return [...part].length <= MAX_TEXT;
    if (!Array.isArray(part) || part.length < 1 || part.length > 2) return false;
    if (typeof part[0] !== "string" || !CODE.test(part[0])) return false;
    if (part.length === 1) return true;
    if (!isObject(part[1]) || depth >= MAX_DEPTH) return false;
    return Object.entries(part[1]).every(([name, value]) =>
        NAME_RE.test(name) && (typeof value === "number" ? Number.isFinite(value) : validPart(value, depth + 1, count)));
}

/** The label stored with a chat message, null for one this client can't read: the message then shows its body alone. */
export function parseLabel(json: unknown): Label | null {
    try {
        const value = typeof json === "string" ? JSON.parse(json) : json;
        if (!isObject(value) || new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) return null;
        if (!Object.keys(value).every(key => LABEL_KEYS.has(key)) || !("n" in value)) return null;
        const count = { parts: 0 };
        if (!validPart(value.n, 0, count)) return null;
        for (const list of [value.t, value.m]) {
            if (list === undefined) continue;
            if (!Array.isArray(list) || !list.every(p => validPart(p, 0, count))) return null;
        }
        if (value.w !== undefined && (typeof value.w !== "string" || !NAME_RE.test(value.w))) return null;
        if (value.k !== undefined && (typeof value.k !== "string" || !kindOf(value.k))) return null;
        return value as unknown as Label;
    } catch {
        return null;
    }
}
