// The words of a roll label (rollLabel.ts) in the reader's language: the
// registry of codes. A code it doesn't know shows its value, so a code dropped
// from the registry still reads as something; to rename one, alias it in
// ALIASES. parseLabel checks what internal/roomws/rolllabel.go checks, on the
// shared examples of internal/roomws/testdata/roll_labels.json.
import { t } from "../i18n";
import { kindOf } from "./kinds";
import { MOD, NAME, SPACE, WRAP, type Label, type Params, type Part } from "./rollLabel";

/** The words of `<space>:<value>`; null for a value the space doesn't know. */
type Words = (value: string, params: Params, kind: string | undefined) => string | null;

/** A parameter as it goes into a phrase: a number as it is, a part in words. */
function param(params: Params, name: string, kind: string | undefined): string | number {
    const value = params[name];
    return typeof value === "number" ? value : value === undefined ? "" : partText(value, kind);
}

const NAMES: Record<string, (kind: string | undefined) => string> = {
    [NAME.initiative]: () => t("sheet.terms.stat.initiative"),
    [NAME.unknownPower]: kind => (kind === "pathfinder_crusade" ? t("sheet.magicPf.psykana.unknownPower") : t("sheet.magic.psykana.unknownPower")),
    [NAME.techPower]: () => t("sheet.termsPowers.tech.techPower"),
    [NAME.rangedAttack]: () => t("sheet.weapons.rangedAttack"),
    [NAME.meleeAttack]: () => t("sheet.weapons.meleeAttack"),
    [NAME.phenomena]: () => t("sheet.magic.phenomena.label"),
};

const MODS: Record<string, (params: Params, kind: string | undefined) => string> = {
    [MOD.safe]: () => t("sheet.magic.roll.safe"),
    [MOD.effectivePR]: (p, kind) => t("sheet.magic.roll.effectivePR", { pr: param(p, "pr", kind) }),
    [MOD.kick]: (p, kind) => t("sheet.magic.roll.kick", { kick: param(p, "kick", kind) }),
    [MOD.twoSustained]: () => t("sheet.magicPf.artsRoll.twoSustained"),
    [MOD.parry]: () => t("sheet.termsSkills.skill.parry"),
};

const SPACES: Record<string, Words> = {
    [SPACE.name]: (value, _, kind) => NAMES[value]?.(kind) ?? null,
    [SPACE.mod]: (value, params, kind) => MODS[value]?.(params, kind) ?? null,
};

/** Codes that were renamed or merged: old code → the code it reads as now. */
const ALIASES: Record<string, string> = {};

/** The words of a code; a code no space knows shows its value, or itself without one. */
function codeText(code: string, params: Params, kind: string | undefined): string {
    const name = ALIASES[code] ?? code;
    const colon = name.indexOf(":");
    const space = colon < 0 ? name : name.slice(0, colon);
    const value = colon < 0 ? "" : name.slice(colon + 1);
    return SPACES[space]?.(value, params, kind) ?? (value || space);
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
    return (label.w && WRAPPERS[label.w]?.(text)) || text;
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
