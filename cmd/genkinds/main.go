// Command genkinds writes the list of sheet kinds for the client, so that
// every kind the server knows has a layout there:
//
//	npm run gen:types
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"charactersheet.iociveteres.net/internal/models"
)

const output = "ui/static/js/sheet/kinds/kinds.gen.ts"

func main() {
	kinds := []string{}
	for _, info := range models.SheetKinds() {
		kinds = append(kinds, string(info.Kind))
	}
	list, err := json.Marshal(kinds)
	if err != nil {
		log.Fatal(err)
	}

	var buf bytes.Buffer
	buf.WriteString("// Source: internal/models/sheet_kinds.go.\n")
	buf.WriteString("// Regenerate with `npm run gen:types`.\n\n")
	fmt.Fprintf(&buf, "export const SHEET_KINDS = %s as const;\n\n", list)
	buf.WriteString("export type SheetKind = (typeof SHEET_KINDS)[number];\n\n")
	fmt.Fprintf(&buf, "export const DEFAULT_SHEET_KIND: SheetKind = %q;\n", models.DefaultSheetKind)

	if err := os.WriteFile(output, buf.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
}
