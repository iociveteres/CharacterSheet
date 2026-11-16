// A chat message: its text, the result of its command and its time. The room's
// chat and the bestiary's roll feed show the same.
import type { ComponentChildren } from "preact";
import type { ChatMessage as Message } from "../payload.gen";
import { formatTime } from "../time_format";
import { renderResult } from "../commandResult";

/** `own` puts the message on the right; `menu` goes before its time. */
export function ChatMessage({ msg, own, menu }: {
    msg: Pick<Message, "messageBody" | "commandResult" | "resultData" | "createdAt">; own: boolean; menu?: ComponentChildren;
}) {
    // Messages stored before result_data have the English text only.
    const result = (msg.resultData && renderResult(msg.resultData)) || msg.commandResult;
    return (
        <div class={own ? "message own-message" : "message"}>
            <div class="message-body">{msg.messageBody}</div>
            {result && <div class="command-result">{result}</div>}
            <div class="message-footer">
                <div class="message-time-wrapper">
                    {menu}
                    <div class="message-time">{formatTime(new Date(msg.createdAt))}</div>
                </div>
            </div>
        </div>
    );
}
