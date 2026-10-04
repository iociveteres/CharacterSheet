import { toasts } from "../state";
import { runToastAction } from "../actions";

/** The notices of the room, rendered into the .toasts live region of the page. */
export function Toasts() {
    return (
        <>
            {toasts.value.map(t => (
                <div key={t.id} class="toast">
                    {t.message}
                    {t.action && <button type="button" class="toast-action" onClick={() => runToastAction(t)}>{t.action.label}</button>}
                </div>
            ))}
        </>
    );
}
