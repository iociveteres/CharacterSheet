// The sections of a list of collections, on the bestiary page and in the
// room's "From bestiary": the user's own and the public ones of others they
// subscribed to.
import type { BestiaryCollection } from "./types.gen";

export type Section = "own" | "subscribed";

export const sectionOf = (c: BestiaryCollection): Section => c.own ? "own" : "subscribed";
