// The portrait beside the character's name, only in the full sheet
// (CharacterInfo); a click on it opens the portrait window (PortraitEditor).
// The image is served by its hash, GET /portrait/:hash; the hash changes only
// with portraitChanged (state/remote.ts), also after this tab's own upload,
// so every tab shows the same.
import { render, type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSheet } from "../components/context";
import { isImageFile, NOT_AN_IMAGE, PortraitEditor } from "./PortraitEditor";

/** An image on its way to the server, shown in the frame meanwhile. */
interface Upload {
    /** An object URL of the image. */
    url: string;
    /** The portrait before the upload: the preview stays until portraitChanged replaces it. */
    from: string | null;
    sending: boolean;
}

/** Whether CharacterInfo shows the portrait's cell: a viewer sees none on a sheet without one. */
export const showsPortrait = (portrait: string | null, canEdit: boolean) => portrait !== null || canEdit;

export function Portrait() {
    const { portrait, canEdit, actions } = useSheet();
    const hash = portrait.value;
    const [upload, setUpload] = useState<Upload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [full, setFull] = useState(false);
    /** The portrait window, open on a file or on the saved portrait; a new key opens it anew. */
    const [editing, setEditing] = useState<{ file: File | null; key: number } | null>(null);
    const [dropping, setDropping] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const cell = useRef<HTMLDivElement>(null);

    // Until the hash comes, the frame would show the old portrait again.
    useEffect(() => {
        if (upload && !upload.sending && hash !== upload.from) setUpload(null);
    }, [hash, upload]);
    useEffect(() => {
        if (!upload) return;
        const { url } = upload;
        return () => URL.revokeObjectURL(url);
    }, [upload?.url]);

    const send = (image: Blob) => {
        const url = URL.createObjectURL(image);
        const current = (u: Upload | null) => u?.url === url;
        setError(null);
        setUpload({ url, from: hash, sending: true });
        actions.uploadPortrait(image).then(
            () => setUpload(u => current(u) ? { ...u!, sending: false } : u),
            (err: unknown) => {
                setUpload(u => current(u) ? null : u);
                setError(err instanceof Error ? err.message : String(err));
            },
        );
    };

    /** Opens the portrait window on `file`, a picked or dropped image, or on the saved portrait when null. */
    const edit = (file: File | null) => {
        if (file && !isImageFile(file)) {
            setError(NOT_AN_IMAGE);
            return;
        }
        setError(null);
        setEditing(e => ({ file, key: (e?.key ?? 0) + 1 }));
    };

    const remove = () => {
        setEditing(null);
        setError(null);
        actions.deletePortrait().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };

    const onPicked = (e: JSX.TargetedEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        const file = input.files?.[0] ?? null;
        // The same file picked again must fire change again.
        input.value = "";
        if (file) edit(file);
    };

    const src = upload?.url ?? (hash ? `/portrait/${hash}` : null);
    useFullView(cell, full ? src : null, () => setFull(false));

    if (!showsPortrait(hash, canEdit)) return null;

    const editable = canEdit && !upload?.sending;
    // An empty frame asks for a file at once: the window opens with the image in it.
    const open = () => {
        if (!src) picker.current?.click();
        else if (!editing) edit(null);
    };
    const frameProps: JSX.HTMLAttributes<HTMLDivElement> = editable
        ? {
            role: "button",
            tabIndex: 0,
            onClick: open,
            onKeyDown: e => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                open();
            },
            onDragOver: e => {
                if (!e.dataTransfer?.types.includes("Files")) return;
                e.preventDefault();
                setDropping(true);
            },
            onDragLeave: () => setDropping(false),
            onDrop: e => {
                e.preventDefault();
                setDropping(false);
                const file = e.dataTransfer?.files[0];
                if (file) edit(file);
            },
        }
        : {};
    const state = `${canEdit ? " editable" : ""}${upload?.sending ? " uploading" : ""}${editing ? " active" : ""}${dropping ? " drop" : ""}`;

    return (
        <div ref={cell} class="portrait-cell" data-id="portrait">
            {src
                ? (
                    <div class={`portrait${state}`} title={editable ? "Edit the portrait" : undefined} {...frameProps}>
                        <img src={src} alt="Portrait" />
                        {upload?.sending && <div class="spinner" />}
                        {editable && <div class="edit-strip">✎ Edit</div>}
                        <div class="corner">
                            <button type="button" class="portrait-full-open" title="Full size" aria-label="Full size"
                                onClick={e => {
                                    e.stopPropagation();
                                    setFull(true);
                                }}
                                onKeyDown={e => e.stopPropagation()}>
                                ⤢
                            </button>
                        </div>
                    </div>
                )
                : (
                    <div class={`portrait empty${state}`} title="Upload a portrait (or drop an image here)" {...frameProps}>+ Portrait</div>
                )}
            {canEdit && <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPicked} />}
            {error && <div class="portrait-error">{error}</div>}
            {canEdit && editing && (
                <div class="portrait-pop">
                    <PortraitEditor key={editing.key} file={editing.file} saved={hash ? `/portrait/${hash}` : null} anchor={cell}
                        onSave={image => {
                            setEditing(null);
                            send(image);
                        }}
                        onDelete={remove}
                        onClose={() => setEditing(null)} />
                </div>
            )}
        </div>
    );
}

/**
 * Shows the full view of `src` while it is not null. It goes straight into
 * the sheet's shadow root: inside the tab panel, which is a stacking context
 * of its own, the sheet's controls would cover it.
 */
function useFullView(cell: { current: HTMLElement | null }, src: string | null, close: () => void): void {
    useEffect(() => {
        if (!src || !cell.current) return;
        const root = cell.current.getRootNode();
        const host = document.createElement("div");
        (root instanceof ShadowRoot ? root : document.body).append(host);
        render(<PortraitFull src={src} close={close} />, host);
        return () => {
            render(null, host);
            host.remove();
        };
    }, [src]);
}

/** The portrait at its full size over the whole screen; ×, Esc and a click beside it close it. */
function PortraitFull({ src, close }: { src: string; close: () => void }) {
    useEffect(() => {
        // In capture on window and stopped: Esc must not also close the
        // popup the sheet may be shown in (room/components/overlay.ts).
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    return (
        <div class="portrait-full" role="dialog" aria-modal="true" aria-label="Portrait"
            onClick={e => {
                if (e.target === e.currentTarget) close();
            }}>
            <figure>
                <button type="button" class="portrait-full-close" title="Close" aria-label="Close" onClick={close}>×</button>
                <img src={src} alt="Portrait" />
            </figure>
        </div>
    );
}
