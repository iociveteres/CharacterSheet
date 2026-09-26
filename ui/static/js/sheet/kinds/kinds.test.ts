import { expect, it } from "vitest";
import { layoutOf } from "./index";

// tsc checks that every kind of kinds.gen.ts has a layout (the type of LAYOUTS).
it("has no layout for a kind this bundle does not know", () => {
    expect(layoutOf("black_crusade")).toBeTypeOf("function");
    expect(layoutOf("great_crusade")).toBeNull();
    expect(layoutOf("toString")).toBeNull();
});
