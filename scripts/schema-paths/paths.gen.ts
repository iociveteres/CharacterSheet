// Writes every path of a stored field the client schemas know, of every sheet
// kind, to internal/models/testdata/schema_paths.json: a Go test requires the
// server's shape check (internal/models/sheet_paths.go) to take each of them.
// "*" stands for an item id; computed outputs are not stored and left out.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { KINDS } from "../../ui/static/js/sheet/kinds";
import type { Spec } from "../../ui/static/js/sheet/schema/spec";

function collect(spec: Spec, at: string[], out: Set<string>): void {
    switch (spec.kind) {
        case "computed":
            return;
        case "field":
            out.add(at.join("."));
            return;
        case "group":
            for (const [key, field] of Object.entries(spec.fields)) collect(field, [...at, key], out);
            return;
        case "grid":
            collect(spec.item, [...at, "items", "*"], out);
            return;
    }
}

test("schema paths", () => {
    const out = new Set<string>();
    for (const kind of Object.values(KINDS)) collect(kind.schema, [], out);
    // npm runs it from the repository root; import.meta.url is not a file URL under happy-dom.
    writeFileSync("internal/models/testdata/schema_paths.json", JSON.stringify([...out].sort(), null, 2) + "\n");
});
