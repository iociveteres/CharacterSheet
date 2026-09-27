// The chat commands of rolls, and the dice roller's settings in localStorage.
// The server reads the commands (internal/commands).

export interface DiceSettings {
    /** Number of dice, 1 to 5. */
    amount: number;
    /** -60 to +60 in tens. */
    modifier: number;
    /** The four targets to roll against, as typed. */
    rollAgainst: string[];
    /** The checked target, if any. */
    selected: number | null;
}

export const DICE_PRESET_SLOTS = 5;

/** The label of a roll from the sheet, under the command as `>>` lines. */
function labelLines(label: string): string {
    if (!label.trim()) return "";
    const lines = label
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map(l => l.replace(/^\s*>>\s*/, "").trim())
        .filter(l => l.length > 0)
        .join("\n>> ");
    const max = 200;
    return `\n>> ${lines.length > max ? lines.slice(0, max) + "…" : lines}`;
}

/** A d100 test from the sheet; bonus successes show only when there are any. */
export function rollVersusCommand(target: number, bonusSuccesses: number, label: string): string {
    const bonus = bonusSuccesses > 0 ? ` [+${bonusSuccesses}]` : "";
    return `/r d100 vs ${target}${bonus}${labelLines(label)}`;
}

export function rollExactCommand(expression: string, label: string): string {
    return `/r ${expression}${labelLines(label)}`;
}

/** The target checked in the roller; null when none is, or it is not a number from 1. */
function activeTarget(settings: DiceSettings): number | null {
    if (settings.selected === null) return null;
    const target = parseInt(settings.rollAgainst[settings.selected]?.trim() ?? "", 10);
    return isNaN(target) || target < 1 ? null : target;
}

/**
 * A roll of the roller's dice buttons. Against a target the modifier moves the
 * target; otherwise it is added to the roll.
 */
export function standardRollCommand(sides: number, settings: DiceSettings): string {
    const command = `/r ${settings.amount}d${sides}`;
    const target = activeTarget(settings);
    if (target !== null) return `${command} vs ${target + settings.modifier}`;
    if (settings.modifier === 0) return command;
    return `${command}${settings.modifier > 0 ? "+" : ""}${settings.modifier}`;
}

/** A preset may be written with or without /r; null for an empty one. */
export function presetRollCommand(notation: string): string | null {
    const trimmed = notation.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("/r") ? trimmed : `/r ${trimmed}`;
}

// — Settings ——————————————————————————————

// The keys hold the settings players saved before the room moved to Preact.
const amountKey = (roomId: number) => `dice_amount_room_${roomId}`;
const modifierKey = (roomId: number) => `dice_modifier_room_${roomId}`;
const targetKey = (roomId: number, index: number) => `dice_roll_against_${index}_room_${roomId}`;
const selectedKey = (roomId: number) => `dice_roll_against_selected_room_${roomId}`;

/** The settings saved for the room; a value out of its range is left at the default. */
export function readDiceSettings(roomId: number): DiceSettings {
    const settings: DiceSettings = { amount: 1, modifier: 0, rollAgainst: ["", "", "", ""], selected: null };
    try {
        const amount = parseInt(localStorage.getItem(amountKey(roomId)) ?? "", 10);
        if (amount >= 1 && amount <= 5) settings.amount = amount;

        const modifier = parseInt(localStorage.getItem(modifierKey(roomId)) ?? "", 10);
        if (modifier >= -60 && modifier <= 60) settings.modifier = modifier;

        settings.rollAgainst = settings.rollAgainst.map((_, i) => localStorage.getItem(targetKey(roomId, i)) ?? "");

        const selected = parseInt(localStorage.getItem(selectedKey(roomId)) ?? "", 10);
        if (selected >= 0 && selected <= 3) settings.selected = selected;
    } catch (err) {
        console.error("Failed to load dice settings:", err);
    }
    return settings;
}

/** Saves the settings; an empty target and no checked target are removed. */
export function saveDiceSettings(roomId: number, settings: DiceSettings): void {
    try {
        localStorage.setItem(amountKey(roomId), String(settings.amount));
        localStorage.setItem(modifierKey(roomId), String(settings.modifier));
        settings.rollAgainst.forEach((value, i) => {
            if (value.trim()) localStorage.setItem(targetKey(roomId, i), value.trim());
            else localStorage.removeItem(targetKey(roomId, i));
        });
        if (settings.selected === null) localStorage.removeItem(selectedKey(roomId));
        else localStorage.setItem(selectedKey(roomId), String(settings.selected));
    } catch (err) {
        console.error("Failed to save dice settings:", err);
    }
}
