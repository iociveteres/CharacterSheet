import { expect, it } from "vitest";
import { loadState } from "../components/testUtils";
import { collectEntries } from "./entries";

it("fails to count entries of a state without the kind's computeds rather than count none", () => {
    expect(() => collectEntries(loadState({}), "char_bonus")).toThrow(/entry index/);
});
