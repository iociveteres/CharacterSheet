import { toasts } from "../state";

/** The notices of the room, rendered into the .toasts live region of the page. */
export function Toasts() {
    return (
        <>
            {toasts.value.map(t => <div key={t.id} class="toast">{t.message}</div>)}
        </>
    );
}
