// The hardware of a tech power: the implants its Implants field names, found
// among the cybernetics and gear of the sheet. The worst quality of them
// modifies the power's tests and the I of its effects, but not the tests of a
// Compensator.
import { idsInOrder } from "./gridOrder";
import { textAt, valueAt } from "./sync";

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

/** The implants a power needs, as its Implants field names them; those in words, as "2+ мехадендрита", are left to the players. */
export function neededHardware(implants: string): string[] {
    return implants
        .split(/,|\/| или | or /i)
        .map(name => name.trim())
        .filter(name => /^[A-Za-z]/.test(name) && !/^(no|none)$/i.test(name));
}

export interface Hardware {
    /** What the worst of the implants it needs adds. */
    mod: number;
    /** The implant that sets `mod`, as the power names it, and its quality; null when none of them is below Common or above it. */
    worst: { name: string; quality: string } | null;
    /** The implants it needs that the sheet lacks. */
    missing: string[];
}

/** The hardware of the tech power at `path`: of the items of the same name, the best counts. */
export function hardwareAt(path: string): Hardware {
    const owned = new Map<string, number>();
    for (const list of ["cybernetics", "gear"]) {
        for (const id of idsInOrder(`${list}.list.items`)) {
            const item = `${list}.list.items.${id}`;
            const name = hardwareName(textAt(`${item}.name`));
            const mod = QUALITY_MODS[String(valueAt(`${item}.quality`) || "Common")] ?? 0;
            if (name) owned.set(name, Math.max(owned.get(name) ?? -Infinity, mod));
        }
    }
    const hardware: Hardware = { mod: 0, worst: null, missing: [] };
    let worst = Infinity;
    for (const name of neededHardware(textAt(`${path}.implants`))) {
        const mod = owned.get(hardwareName(name));
        if (mod === undefined) {
            hardware.missing.push(name);
            continue;
        }
        if (mod < worst) {
            worst = mod;
            const quality = Object.keys(QUALITY_MODS).find(q => QUALITY_MODS[q] === mod)!;
            hardware.worst = mod === 0 ? null : { name, quality };
        }
    }
    hardware.mod = Number.isFinite(worst) ? worst : 0;
    return hardware;
}
