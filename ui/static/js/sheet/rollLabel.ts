// The label of a roll as data. What the sheet takes from the catalog goes in
// as a code, which each reader of the chat words in their own language
// (rollLabelText.ts); what the player typed goes in as text. The room stores
// it in room_messages.label_data, so codes are stored data: never rename one,
// alias it in rollLabelText.ts. The server checks only the shape and the limits
// (internal/roomws/rolllabel.go). Format and namespaces: _prd/roll_labels/plan.md.

/** The parameters of a code: numbers, or parts worded like the rest of the label. */
export interface Params {
    [name: string]: number | Part;
}

/** Text as typed, or a code with its parameters: a string is always text, an array always a code. */
export type Part = string | [code: string] | [code: string, params: Params];

/** Worded as `n (t, t), m, m`, then put into the wrapper `w`, if any. */
export interface Label {
    n: Part;
    t?: Part[];
    m?: Part[];
    w?: string;
    /**
     * The sheet kind whose characteristics, skills and terms the codes name;
     * none for black_crusade. A SheetKind (kinds/kinds.gen.ts), which this
     * file can't import: it is in a layer above.
     */
    k?: string;
}

/** The namespaces of codes, `<space>:<value>`. The key of a roll column is a namespace too. */
export const SPACE = {
    name: "name",
    mod: "mod",
    grip: "grip",
    stance: "stance",
    profile: "profile",
    quality: "quality",
    char: "char",
    skill: "skill",
    skillGroup: "skillGroup",
    src: "src",
    hit: "hit",
    linked: "linked",
} as const;

/** The codes of name:*, phrases the sheet puts in place of a name. */
export const NAME = {
    unknown: "unknown",
    unknownPower: "unknownPower",
    techPower: "techPower",
    rangedAttack: "rangedAttack",
    meleeAttack: "meleeAttack",
    compensator: "compensator",
    phenomena: "phenomena",
    initiative: "initiative",
} as const;

/** The codes of mod:*, one-off phrases among the modifiers. */
export const MOD = {
    safe: "safe",
    effectivePR: "effectivePR",
    kick: "kick",
    twoSustained: "twoSustained",
    parry: "parry",
} as const;

/** The codes of src:*, the names of sources that have none of their own; `src:stance.<key>` names a stance. */
export const SRC = {
    condition: "condition",
    item: "item",
    stance: "stance",
} as const;

/** The wrappers of a whole label. */
export const WRAP = {
    broken: "broken",
} as const;

/** The code `<space>:<value>`, or `<space>` alone without a value, with its parameters if any. */
export function code(space: string, value?: string | null, params?: Params): Part {
    const name = value == null || value === "" ? space : `${space}:${value}`;
    return params ? [name, params] : [name];
}

/** A label of name `n`; empty lists are left out. */
export function label(n: Part, { t, m, w, k }: { t?: Part[]; m?: Part[]; w?: string; k?: string } = {}): Label {
    return {
        n,
        ...(t?.length ? { t } : {}),
        ...(m?.length ? { m } : {}),
        ...(w ? { w } : {}),
        ...(k && k !== "black_crusade" ? { k } : {}),
    };
}
