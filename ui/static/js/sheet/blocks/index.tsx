// The blocks Preact renders, by the data-block name of their mount point in
// the sheet layout (ui/html/kinds/*.html).
import type { VNode } from "preact";
import { mountBlock } from "../components/mount";
import { Conditions } from "./Conditions";
import { CustomSkills } from "./CustomSkills";
import { Experience } from "./Experience";
import { CarryWeight, Cybernetics, Gear } from "./Gear";
import { Diseases, MentalDisorders, Mutations, Notes, Talents, Traits } from "./NamedDescriptions";
import { PowerShields } from "./PowerShields";
import { ResourceTrackers } from "./ResourceTrackers";

export const BLOCKS: { readonly [name: string]: () => VNode } = {
    "conditions": () => <Conditions />,
    "custom-skills": () => <CustomSkills />,
    "notes": () => <Notes />,
    "resource-trackers": () => <ResourceTrackers />,
    "power-shields": () => <PowerShields />,
    "traits": () => <Traits />,
    "talents": () => <Talents />,
    "mutations": () => <Mutations />,
    "mental-disorders": () => <MentalDisorders />,
    "diseases": () => <Diseases />,
    "carry-weight": () => <CarryWeight />,
    "gear": () => <Gear />,
    "cybernetics": () => <Cybernetics />,
    "experience": () => <Experience />,
};

/** Mounts every block whose mount point the sheet has. */
export function mountBlocks(root: ParentNode): void {
    for (const mount of Array.from(root.querySelectorAll<HTMLElement>("[data-block]"))) {
        const block = BLOCKS[mount.dataset.block ?? ""];
        if (!block) throw new Error(`The sheet has a mount point for an unknown block "${mount.dataset.block}"`);
        mountBlock(mount, block());
    }
}
