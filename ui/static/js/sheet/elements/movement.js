import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { getRoot } from "../utils.js";
import { collectEntries } from "../state/computed.js";
import { resolveStackExpr } from "../system.js";

export function initMovement() {
    _movementTooltip()
}

function _movementTooltip() {
    const root = getRoot();
    const moveHalfEl = root?.querySelector('input[data-id="moveHalf"]');
    if (!moveHalfEl) return;

    const base = 'Result = A.b + Size + Bonus\nOther bonuses:';

    effect(() => {
        const entries = collectEntries('movement_bonus');
        const parts = entries.map(({ entry, stacks }) => {
            const name = entry.name?.value || '?';
            const bonus = resolveStackExpr(entry.movementBonus?.value, stacks);
            return `${name}: +${bonus}`;
        });
        moveHalfEl.title = parts.length ? `${base}\n${parts.join('\n')}` : base;
    });
}