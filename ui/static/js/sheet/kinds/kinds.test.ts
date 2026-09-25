import { expect, it } from "vitest";
import { SHEET_KINDS } from "./kinds.gen";
import { layoutOf } from "./index";

it("has a layout for every sheet kind the server knows", () => {
    for (const kind of SHEET_KINDS) expect(layoutOf(kind), kind).toBeTypeOf("function");
    expect(layoutOf("great_crusade")).toBeNull();
    expect(layoutOf("toString")).toBeNull();
});
