import { expect, it } from "vitest";
import { kindOf } from "./index";

// tsc checks that every kind of kinds.gen.ts has a definition (the type of KINDS).
it("has no definition for a kind this bundle does not know", () => {
    expect(kindOf("black_crusade")).toMatchObject({ Layout: expect.any(Function) });
    expect(kindOf("great_crusade")).toBeNull();
    expect(kindOf("toString")).toBeNull();
});
