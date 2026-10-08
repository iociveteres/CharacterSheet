// The heading of a block with attacks or powers and its ⚙: the test options
// of their rolls and, for psykana and techno arcana, the rules the sheet
// counts. The rules are the sheet's (settings.<block>), so everyone who opens
// it sees the same numbers.
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useDropdown } from "../components/Dropdown";
import { Checkbox } from "../components/fields";
import { Scope } from "../components/Scope";
import type { TestBlock } from "../state/testOptions";
import { TestOptionList } from "./TestOptions";

export interface Rule {
    field: string;
    label: string;
    title: string;
}

interface BlockSettingsProps {
    block: TestBlock;
    /** What the block rolls, as the label of its test options says it: "Attacks", "Powers". */
    rolls: string;
    /** The title of the ⚙. */
    title: string;
    rules?: readonly Rule[];
}

function BlockSettings({ block, rolls, title, rules }: BlockSettingsProps) {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <div class="block-settings dropdown-parent" ref={ref}>
            {/* The rules are at settings.<block>, out of the block's path: the Scope holds the ⚙ alone. */}
            <Scope dataId={block} as="span">
                <button type="button" class={dropdown.open ? "block-settings-toggle active" : "block-settings-toggle"}
                    title={title} onClick={dropdown.toggle}>⚙</button>
            </Scope>
            {dropdown.open && (
                <div class="roll-dropdown block-settings-dropdown visible">
                    <span class="column-label">{`${rolls} are tested on`}</span>
                    <Scope dataId={block}>
                        <TestOptionList />
                    </Scope>
                    {rules && (
                        <>
                            <span class="column-label">The sheet counts</span>
                            <Scope dataId="settings" class="block-rules">
                                <Scope dataId={block} class="block-rules">
                                    {rules.map(rule => (
                                        <label key={rule.field} class="block-rule" title={rule.title}>
                                            <Checkbox field={rule.field} class="custom" />
                                            <span>
                                                <span class="block-rule-label">{rule.label}</span>
                                                <span class="block-rule-text">{rule.title}</span>
                                            </span>
                                        </label>
                                    ))}
                                </Scope>
                            </Scope>
                            <span class="block-settings-note">These are the sheet's: everyone who opens it sees the same.</span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

interface BlockHeadingProps extends BlockSettingsProps {
    level: "h2" | "h3";
    heading: string;
    /** Under the heading, e.g. a notice. */
    children?: ComponentChildren;
}

/** The heading, centred, with the ⚙ of its block just right of it. */
export function BlockHeading({ level: H, heading, children, ...settings }: BlockHeadingProps) {
    return (
        <div class="block-heading-block">
            <div class="block-heading">
                <H>{heading}</H>
                <BlockSettings {...settings} />
            </div>
            {children}
        </div>
    );
}
