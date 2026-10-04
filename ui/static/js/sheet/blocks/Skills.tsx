// The skill table: fixed skills on the left, skills with an editable name on
// the right, rendered from the skill lists of the schema.
import { Fragment } from "preact";
import { NumberField, Select, TextField } from "../components/fields";
import { peekAt } from "../state/sync";
import { Scope } from "../components/Scope";
import { SKILL_CHARACTERISTICS, SKILLS_LEFT, SKILLS_RIGHT, type SkillRow } from "../schema/constants";
import { AdvanceCheckboxes, Difficulty } from "./skillParts";
import { useSheet } from "../components/context";

function SkillCells({ rowPath, label }: { rowPath: string; label: () => string }) {
    return (
        <>
            <td><Select field="characteristic" options={SKILL_CHARACTERISTICS} /></td>
            <AdvanceCheckboxes rowPath={rowPath} cells />
            <td><NumberField field="miscBonus" class="short textlike" /></td>
            <td><Difficulty rowPath={rowPath} label={label} /></td>
        </>
    );
}

/** Rows of `rows`, with a heading row before each group. */
function SkillRows({ table, rows, editableName }: { table: string; rows: readonly SkillRow[]; editableName: boolean }) {
    const { state } = useSheet();
    return (
        <>
            {rows.map((row, i) => {
                const rowPath = `${table}.${row.key}`;
                const heading = row.group && row.group !== rows[i - 1]?.group ? row.group : null;
                // Grouped fixed skills are sub-skills of the heading; editable ones stand on their own.
                const subskill = !editableName && !!row.group;
                return (
                    <Fragment key={row.key}>
                        {heading && <tr class={editableName ? undefined : "skill-header"}><td>{heading}</td></tr>}
                        <Scope as="tr" dataId={row.key} class={subskill ? "subskill" : undefined}>
                            <td>{editableName ? <TextField field="name" /> : row.label}</td>
                            <SkillCells
                                rowPath={rowPath}
                                label={() => (editableName ? String(peekAt(state, `${rowPath}.name`) ?? "") : row.label)}
                            />
                        </Scope>
                    </Fragment>
                );
            })}
        </>
    );
}

export function Skills() {
    return (
        <>
            <Scope as="table" dataId="skillsLeft">
                <tbody><SkillRows table="skillsLeft" rows={SKILLS_LEFT} editableName={false} /></tbody>
            </Scope>
            <Scope as="table" dataId="skillsRight">
                <tbody><SkillRows table="skillsRight" rows={SKILLS_RIGHT} editableName /></tbody>
            </Scope>
        </>
    );
}
