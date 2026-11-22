import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { formatCount, lang, t, type Dictionary } from "./index";
import { installDictionary } from "./testDictionary";
import { DiceRoller } from "../room/components/DiceRoller";
import { initRoomState } from "../room/state";
import type { RoomPayload } from "../room/payload.gen";

// The keys below are not in the catalog, so t() is called past its key types.
const tr = t as unknown as (key: string, params?: Record<string, string | number>) => string;

const MESSAGES: Record<"en" | "ru", Dictionary["messages"]> = {
    en: {
        "test.greeting": "Hello, {name}! {name} has {n} points",
        "test.successes": { one: "{count} success", other: "{count} successes" },
        "test.onlyEn": "Only English",
    },
    ru: {
        "test.greeting": "Привет, {name}! У {name} {n} очков",
        "test.successes": { one: "{count} успех", few: "{count} успеха", many: "{count} успехов" },
        // Built from an en entry without ru: clientDictionary puts the en forms here.
        "test.onlyEn": "Only English",
        "test.enForms": { one: "{count} item", other: "{count} items" },
        "test.partial": { one: "{count} успех", few: "{count} успеха" },
    },
};

const use = (l: "en" | "ru") => { globalThis.__I18N__ = { lang: l, messages: MESSAGES[l] }; };

describe("t", () => {
    it("replaces every {name} with its param and leaves unknown ones", () => {
        use("en");
        expect(tr("test.greeting", { name: "Ann", n: 3 })).toBe("Hello, Ann! Ann has 3 points");
        expect(tr("test.greeting", { name: "Ann" })).toBe("Hello, Ann! Ann has {n} points");
    });

    it("picks the English plural form by count", () => {
        use("en");
        expect(tr("test.successes", { count: 1 })).toBe("1 success");
        expect(tr("test.successes", { count: 2 })).toBe("2 successes");
        expect(tr("test.successes", { count: 0 })).toBe("0 successes");
    });

    it("picks the Russian plural form by count", () => {
        use("ru");
        const forms = [1, 2, 5, 11, 21, 22, 25].map(count => tr("test.successes", { count }));
        expect(forms).toEqual(["1 успех", "2 успеха", "5 успехов", "11 успехов", "21 успех", "22 успеха", "25 успехов"]);
        // Fractions select "other", which the catalog has no ru form for.
        expect(tr("test.successes", { count: 1.5 })).toBe("1.5 успеха");
    });

    it("sets the thousands of count apart by a narrow no-break space, and of no other param", () => {
        use("ru");
        const nb = String.fromCharCode(0x202f);
        expect(tr("test.successes", { count: 4522 })).toBe(`4${nb}522 успеха`);
        expect(tr("test.greeting", { name: "Ann", n: 2026 })).toBe("Привет, Ann! У Ann 2026 очков");
        expect(tr("test.successes", { count: 1500.5 })).toBe("1500.5 успеха");
    });

    it("falls back to another form when the language lacks one", () => {
        use("ru");
        expect(tr("test.enForms", { count: 5 })).toBe("5 items");
        expect(tr("test.enForms", { count: 1 })).toBe("1 item");
        expect(tr("test.partial", { count: 5 })).toBe("5 успеха");
    });

    it("returns an unknown key as is, and keys without a dictionary", () => {
        use("ru");
        expect(tr("test.missing")).toBe("test.missing");
        globalThis.__I18N__ = undefined;
        expect(tr("test.greeting", { name: "Ann" })).toBe("test.greeting");
        expect(lang()).toBe("en");
    });

    it("reads the language of the installed dictionary", () => {
        use("ru");
        expect(lang()).toBe("ru");
    });
});

describe("formatCount", () => {
    it("groups the thousands of an integer from 1000 on, as the server does", () => {
        const nb = String.fromCharCode(0x202f);
        expect([0, 999, 1000, 1024, -4512, 123456, 1234567].map(formatCount)).toEqual(
            ["0", "999", `1${nb}000`, `1${nb}024`, `-4${nb}512`, `123${nb}456`, `1${nb}234${nb}567`]);
        expect(formatCount(1234.5)).toBe("1234.5");
    });
});

describe("the catalog dictionaries", () => {
    it("are en in every test unless one installs another", () => {
        expect(lang()).toBe("en");
        const english = t("common.close");
        expect(english).not.toBe("common.close");
        installDictionary("ru");
        expect(lang()).toBe("ru");
        expect(t("common.close")).not.toBe(english);
    });
});

describe("a component", () => {
    let root: HTMLElement;

    afterEach(() => {
        render(null, root);
        root.remove();
    });

    it("renders its strings in the installed language", () => {
        initRoomState({
            roomId: 5, csrfToken: "", inviteLink: "", players: [], commands: [], dicePresets: [],
            chat: { messages: [], hasMore: false },
        } as unknown as RoomPayload);
        root = document.createElement("div");
        document.body.append(root);
        const header = () => {
            act(() => render(null, root));
            act(() => render(<DiceRoller />, root));
            act(() => root.querySelector<HTMLElement>(".dice-roller-btn")!.click());
            return [root.querySelector(".dice-popover-header span")?.textContent, root.querySelector(".dice-close-btn")?.getAttribute("title")];
        };
        const english = header();
        installDictionary("ru");
        const russian = header();

        expect(russian[0]).not.toBe(english[0]);
        expect(russian[1]).not.toBe(english[1]);
    });
});
