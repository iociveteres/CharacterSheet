import type { NamedDescription } from "../schema/content.gen";

export function namedDescriptionFactory(): NamedDescription {
    return { name: "", description: "" };
}
