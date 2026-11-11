// The cases of TestColumnsFromLayout (internal/templates/sheet_fincs_test.go).
// The Go test goes away with the templates on stage 5; this copy stays.
import { describe, expect, it } from "vitest";
import { columnsFromLayout } from "./columns";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

describe("columnsFromLayout", () => {
    it("returns empty columns for no items", () => {
        expect(columnsFromLayout(1, undefined, [])).toEqual([[]]);
    });

    it("puts everything in a single column", () => {
        expect(columnsFromLayout(1, undefined, ["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    });

    it("deals unplaced items row by row across columns", () => {
        expect(columnsFromLayout(3, undefined, ["a", "b", "c", "d", "e"])).toEqual([["a", "d"], ["b", "e"], ["c"]]);
    });

    it("respects layout positions", () => {
        expect(columnsFromLayout(3, { x: pos(0, 0), y: pos(1, 0) }, ["x", "y"])).toEqual([["x"], ["y"], []]);
    });

    it("places items without a position into the columns that are short", () => {
        expect(columnsFromLayout(3, { x: pos(0, 0) }, ["x", "y", "z"])).toEqual([["x"], ["y"], ["z"]]);
    });

    it("clamps column indexes out of range", () => {
        expect(columnsFromLayout(3, { x: pos(-1, 0), y: pos(10, 0) }, ["x", "y"])).toEqual([["x"], [], ["y"]]);
    });

    it("skips positions without an item", () => {
        expect(columnsFromLayout(3, { ghost: pos(0, 0), x: pos(0, 1), y: pos(1, 0) }, ["x", "y"]))
            .toEqual([["x"], ["y"], []]);
    });

    it("orders unplaced items by id", () => {
        expect(columnsFromLayout(3, undefined, ["c", "a", "b"])).toEqual([["a"], ["b"], ["c"]]);
    });

    it("sorts a column by row, then by id", () => {
        expect(columnsFromLayout(1, { b: pos(0, 1), a: pos(0, 1), c: pos(0, 0) }, ["a", "b", "c"]))
            .toEqual([["c", "a", "b"]]);
    });
});
