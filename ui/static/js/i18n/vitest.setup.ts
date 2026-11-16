// Tests read English text. Installed at load too, for t() at module level of
// the modules a test file imports; a test that needs another language calls
// installDictionary itself, and the next test is back on en.
import { beforeEach } from "vitest";
import { installDictionary } from "./testDictionary";

installDictionary("en");
beforeEach(() => installDictionary("en"));
