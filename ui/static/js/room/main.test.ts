import { describe, expect, it, vi } from "vitest";

vi.mock("./socket.js", () => ({}));
vi.mock("../sheet/main", () => ({}));
vi.mock("./state", () => ({ initRoomState: vi.fn(), readRoomPayload: vi.fn() }));
vi.mock("./remote", () => ({ listenRemote: vi.fn() }));
vi.mock("./encounter/remote", () => ({ listenEncounter: vi.fn() }));
vi.mock("./encounter/actions", () => ({ initEncounter: vi.fn() }));
vi.mock("./islands", () => ({
    mountIslands: vi.fn(() => {
        throw new Error("island failed");
    }),
}));

describe("the room page", () => {
    it("shows the room even when an island fails to mount", async () => {
        vi.useFakeTimers();
        document.body.innerHTML = `<div class="room" id="room" hidden></div>`;

        await expect(import("./main")).rejects.toThrow("island failed");

        expect(document.getElementById("room")!.hidden).toBe(false);
        expect(document.body.classList.contains("no-transitions")).toBe(true);
        vi.advanceTimersByTime(100);
        expect(document.body.classList.contains("no-transitions")).toBe(false);
        vi.useRealTimers();
    });
});
