// The rolls of the page in a panel at the bottom right, over the full sheet
// too: the server answers them to this tab only (bestiary/rolls.ts). Each
// shows as a chat message under the character who rolled.
import { useLayoutEffect, useRef } from "preact/hooks";
import { rolls, rollsCollapsed } from "../state";
import { toggleRolls } from "../actions";
import { ChatMessage } from "../../room/components/ChatMessage";

export function RollFeed() {
    const list = rolls.value;
    const collapsed = rollsCollapsed.value;
    const scroller = useRef<HTMLDivElement>(null);
    // The newest roll is in view.
    useLayoutEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [list, collapsed]);

    if (!list.length) return null;
    return (
        <section class={collapsed ? "roll-feed collapsed" : "roll-feed"} aria-label="Rolls">
            <button type="button" class="roll-feed-header" aria-expanded={!collapsed} onClick={toggleRolls}>
                <span>Rolls</span>
                <span aria-hidden="true">{collapsed ? "▴" : "▾"}</span>
            </button>
            {!collapsed && (
                <div class="roll-feed-list" ref={scroller}>
                    {list.map(roll => (
                        <div key={roll.id} class="roll-feed-row">
                            {roll.characterName && <div class="roll-feed-name">{roll.characterName}</div>}
                            <ChatMessage msg={roll} own={false} />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
