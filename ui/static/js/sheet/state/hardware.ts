// The hardware of a tech power: the implants its Implants field names, found
// among the cybernetics, gear and weapons of the sheet. The worst quality of
// them modifies the power's tests and the I of its effects, but not the tests
// of a Compensator.
import { sheetComputed } from "./state";
import { idsInOrder } from "./gridOrder";
import { textAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** What a quality adds; Common, and an item without one, adds nothing. */
export const QUALITY_MODS: { readonly [quality: string]: number } = { Poor: -10, Common: 0, Good: 5, Best: 10 };

/**
 * A name as the Implants of a power and the collections write it alike:
 * "Noospheric Uplink [Space Marine or Abhuman]", "Noospheric Emitters" and
 * "Medicae MCD" are "noospheric uplink", "noospheric emitter" and "medicae
 * mechadendrite".
 */
export function hardwareName(name: string): string {
    return name
        .replace(/\[[^\]]*\]/g, "")
        .toLowerCase()
        .replace(/\bmcd\b/g, "mechadendrite")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/s$/, "");
}

/**
 * The implants a power needs, as its Implants field names them, each with its
 * alternatives: "Medicae MCD или Technical MCD" needs one of the two. Those in
 * words, as "2+ мехадендрита", are left to the players.
 */
export function neededHardware(implants: string): string[][] {
    return implants
        .split(",")
        .map(need => need
            .split(/\/| или | or /i)
            .map(name => name.trim())
            .filter(name => /^[A-Za-z]/.test(name) && !/^(no|none)$/i.test(name)))
        .filter(names => names.length > 0);
}

export interface Hardware {
    /** What the worst of the implants it needs adds. */
    mod: number;
    /** The implant that sets `mod`, as the power names it, and its quality; null when none of them is below Common or above it. */
    worst: { name: string; quality: string } | null;
    /** The implants it needs that the sheet lacks, alternatives joined by "or". */
    missing: string[];
}

// Weapons have no quality: an Omnissiah Axe among the melee attacks is Common.
const HARDWARE_LISTS = ["cybernetics", "gear", "meleeAttacks", "rangedAttacks"];

/** What the items of the sheet add by their names; of the items of the same name, the best counts. */
const ownedHardware = sheetComputed(state => {
    const owned = new Map<string, number>();
    for (const list of HARDWARE_LISTS) {
        for (const id of idsInOrder(state, `${list}.list.items`)) {
            const item = `${list}.list.items.${id}`;
            const name = hardwareName(textAt(state, `${item}.name`));
            const mod = QUALITY_MODS[String(valueAt(state, `${item}.quality`) || "Common")] ?? 0;
            if (name) owned.set(name, Math.max(owned.get(name) ?? -Infinity, mod));
        }
    }
    return owned;
});

/** The hardware of the tech power at `path`: of the alternatives of an implant, the best the sheet has counts. */
export function hardwareAt(state: SheetSignals, path: string): Hardware {
    const owned = ownedHardware(state);
    const hardware: Hardware = { mod: 0, worst: null, missing: [] };
    let worst = Infinity;
    for (const names of neededHardware(textAt(state, `${path}.implants`))) {
        let best: { name: string; mod: number } | null = null;
        for (const name of names) {
            const mod = owned.get(hardwareName(name));
            if (mod !== undefined && (!best || mod > best.mod)) best = { name, mod };
        }
        if (!best) {
            hardware.missing.push(names.join(" or "));
            continue;
        }
        const { name, mod } = best;
        if (mod < worst) {
            worst = mod;
            const quality = Object.keys(QUALITY_MODS).find(q => QUALITY_MODS[q] === mod)!;
            hardware.worst = mod === 0 ? null : { name, quality };
        }
    }
    hardware.mod = Number.isFinite(worst) ? worst : 0;
    return hardware;
}
