// Autocomplete of the sheet: queries a collection for the field being typed in
// and keeps the results of the latest query. The dropdown is rendered by
// components/AutocompleteField.tsx; one field shows it at a time. A field can
// put results of its own sheet before the server's (the In Gear group of an
// attack's name), and lookup asks for one name apart from any field.
import { signal } from "@preact/signals-core";
import type { AutocompleteResult } from "./components/context";

export interface Suggestions {
    input: HTMLInputElement;
    results: AutocompleteResult[];
    /** The option arrows and Enter act on, -1 for none. */
    active: number;
}

export interface AutocompleteOptions {
    send(msg: string): void;
    debounceMs?: number;
    minChars?: number;
}

/** The server's answer to a query (room/socket.js hands it on as ws:autocompleteResult). */
interface ResultMessage {
    eventID: string;
    results: AutocompleteResult[] | null;
}

export class Autocomplete {
    readonly suggestions = signal<Suggestions | null>(null);

    private readonly send: (msg: string) => void;
    private readonly debounceMs: number;
    private readonly minChars: number;
    /** The field typed in last; its query is the one results are shown for. */
    private input: HTMLInputElement | null = null;
    private requestId: string | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** The query typed last and the field's own results for it, shown before the server's. */
    private query = "";
    private local: ((query: string) => AutocompleteResult[]) | undefined;
    /** The lookups waiting for their answer, by event id. */
    private readonly lookups = new Map<string, (results: AutocompleteResult[]) => void>();

    constructor({ send, debounceMs = 200, minChars = 1 }: AutocompleteOptions) {
        this.send = send;
        this.debounceMs = debounceMs;
        this.minChars = minChars;
        document.addEventListener("ws:autocompleteResult", this.onResult);
    }

    /**
     * Queries the collection for the text of `input` once typing pauses; the
     * results of `local` for the query, read when the answer comes, go first.
     */
    type(input: HTMLInputElement, buildQuery: (query: string) => object, local?: (query: string) => AutocompleteResult[]): void {
        clearTimeout(this.timer);
        const query = input.value.trim();
        if (query.length < this.minChars) {
            this.close(input);
            return;
        }
        this.input = input;
        this.query = query;
        this.local = local;
        this.timer = setTimeout(() => {
            this.requestId = crypto.randomUUID();
            this.send(JSON.stringify({ ...buildQuery(query), eventID: this.requestId }));
        }, this.debounceMs);
    }

    /**
     * Asks the server once, apart from the field typed in; resolves to its
     * results, or to none when no answer comes within `timeoutMs`.
     */
    lookup(query: object, timeoutMs = 5000): Promise<AutocompleteResult[]> {
        const eventID = crypto.randomUUID();
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.lookups.delete(eventID);
                resolve([]);
            }, timeoutMs);
            this.lookups.set(eventID, results => {
                clearTimeout(timer);
                this.lookups.delete(eventID);
                resolve(results);
            });
            this.send(JSON.stringify({ ...query, eventID }));
        });
    }

    /** Shows `results` under `input`, as the answer to its query does. */
    show(input: HTMLInputElement, results: AutocompleteResult[]): void {
        this.input = input;
        this.suggestions.value = results.length ? { input, results, active: -1 } : null;
    }

    /** Moves the active option by `step`, staying within the list. */
    move(step: number): void {
        const s = this.suggestions.value;
        if (!s) return;
        const active = Math.max(0, Math.min(s.active + step, s.results.length - 1));
        if (active !== s.active) this.suggestions.value = { ...s, active };
    }

    /** Drops the query and the results of `input`, or of any field without it. */
    close(input?: HTMLInputElement): void {
        if (input && input !== this.input) return;
        clearTimeout(this.timer);
        this.input = null;
        this.requestId = null;
        this.local = undefined;
        this.suggestions.value = null;
    }

    /** Stops listening for results. Call on sheet teardown. */
    destroy(): void {
        this.close();
        for (const answer of [...this.lookups.values()]) answer([]);
        document.removeEventListener("ws:autocompleteResult", this.onResult);
    }

    private onResult = (e: Event) => {
        const { eventID, results } = (e as CustomEvent<ResultMessage>).detail;
        const lookup = this.lookups.get(eventID);
        if (lookup) return lookup(results ?? []);
        if (eventID !== this.requestId || !this.input) return;
        this.show(this.input, [...(this.local?.(this.query) ?? []), ...(results ?? [])]);
    };
}
