import { describe, expect, it } from "vitest";
import { checkAll } from "./rules.mjs";

const fixture = name => {
    const dir = `scripts/i18n/testdata/${name}`;
    return checkAll({
        catalogDir: `${dir}/catalog`,
        roots: { client: [`${dir}/src`], go: [`${dir}/src`], templates: [`${dir}/src`] },
        largeTextDirs: { content: `${dir}/content`, mail: `${dir}/mail` },
    });
};

describe("check:i18n", () => {
    it("passes a clean catalog, its uses and its large texts", () => {
        const { catalog, problems } = fixture("clean");
        expect(problems).toEqual([]);
        expect(catalog.entries).toHaveLength(6);
    });

    describe("on a broken catalog", () => {
        const { problems } = fixture("broken");
        const C = "scripts/i18n/testdata/broken/catalog";
        const reported = text => expect(problems.filter(p => p.includes(text))).not.toEqual([]);

        it("reports what the loader found", () => {
            reported(`${C}/bad.json: not valid JSON`);
            reported("common.dup: also defined in");
        });
        it("reports a key outside its file's prefix", () => {
            reported(`${C}/common.json:13: room.misplaced: a key of this file starts with "common."`);
            reported("site.auth.inner: belongs in site/auth.json");
        });
        it("reports a missing or empty language", () => {
            reported("common.noRu: no ru");
            reported("common.emptyEn: no en");
        });
        it("reports a field other than en, ru, note", () => {
            reported('common.extra: unknown field "ru_old"');
        });
        it("reports placeholders that differ between the languages", () => {
            reported("common.placeholders: placeholders differ: en {name}, ru {nam}");
        });
        it("reports missing and extra plural forms, and plural mixed with plain", () => {
            reported("common.pluralMissing: ru lacks the plural forms many");
            reported("common.pluralExtra: en has plural forms few");
            reported("common.pluralMixed: plural forms in one language and a plain string in another");
        });
        it("reports keys the code uses that the catalog lacks, in each kind of source", () => {
            reported('scripts/i18n/testdata/broken/src/App.tsx:3: "common.missingClient" is not in the catalog');
            reported('scripts/i18n/testdata/broken/src/handler.go:4: "common.missingGo" is not in the catalog');
            reported('scripts/i18n/testdata/broken/src/page.html:2: "common.missingTpl" is not in the catalog');
        });
        it("reports unused keys, but not those an i18n-keys marker covers", () => {
            reported("common.unused: not used in the code");
            expect(problems.filter(p => p.includes("common.dynamic.a"))).toEqual([]);
        });
        it("reports a marker that covers no key", () => {
            reported("App.tsx:1: i18n-keys common.nothing.* covers no catalog key");
        });
        it("reports a large text without both languages", () => {
            reported("about has no ru file (about.ru.html)");
            reported("mail/welcome has no en file");
            reported('welcome.de.html:1: unknown language "de"');
        });
    });
});
