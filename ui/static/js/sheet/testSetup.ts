// Tests build Black Crusade state without initState, so the path lookups
// (specAtPath) read its schema. A test of another kind sets its own.
import { sheetSchema } from "./schema/sheet";
import { setSheetSchema } from "./state/fromJson";

setSheetSchema(sheetSchema);
