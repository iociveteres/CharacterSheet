// Command genkinds writes the sheet kinds as a TS type for the client, so that
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
	"strings"

	"charactersheet.iociveteres.net/internal/models"
)

const output = "ui/static/js/sheet/kinds/kinds.gen.ts"

func main() {
	kinds := []string{}
	for _, info := range models.SheetKinds() {
		kind, err := json.Marshal(info.Kind)
		if err != nil {
			log.Fatal(err)
		}
		kinds = append(kinds, string(kind))
	}

	var buf bytes.Buffer
	buf.WriteString("// Source: internal/models/sheet_kinds.go.\n")
	buf.WriteString("// Regenerate with `npm run gen:types`.\n\n")
	fmt.Fprintf(&buf, "export type SheetKind = %s;\n", strings.Join(kinds, " | "))

	if err := os.WriteFile(output, buf.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
}
