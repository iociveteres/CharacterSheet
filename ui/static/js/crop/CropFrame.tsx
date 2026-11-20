// A picture that its editor crops in place: the frame with the saved image,
// "✎ Edit" on hover, the dashed "+ Title" frame without one, a dropped or
// picked file, the crop window (CropEditor) beside it, the upload with a
// spinner and the error under the frame. The sheet's portrait
// (sheet/profile/Portrait.tsx) and the site's avatar use it with their own
// geometry and texts; the styles are ui/static/css/crop.css.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { CropEditor, NOT_AN_IMAGE } from "./CropEditor";
import { ACCEPT, isImageFile, type CropGeometry } from "./crop";
import { t } from "../i18n";

export interface CropFrameProps {
    /**
     * The page's own name for the picture: the cell takes it as data-id and
     * its parts as classes beside the shared ones (`portrait-cell`,
     * `portrait`, `portrait-error`, `portrait-pop`), for the page's sizes and
     * place of the window.
     */
    name: string;
    geometry: CropGeometry;
    /** What the picture is: the window's heading, the image's alt text and "+ title" on the empty frame. */
    title: string;
    /** The frame's tooltip for its editor. */
    editHint: string;
    /** The empty frame's tooltip. */
    uploadHint: string;
    /** The question Delete asks in the window. */
    confirmDelete: string;
    /** The widths of the window's previews (CropEditorProps.previews). */
    previews: number[];
    /**
     * The URL of the saved picture, or null. An upload stays in the frame
     * until this changes: the page sets it when the server has the new image.
     */
    saved: string | null;
    canEdit: boolean;
    /** Sends the cropped image; a rejection's message shows under the frame. */
    upload(image: Blob): Promise<void>;
    /** Deletes the saved picture; a rejection's message shows under the frame. */
    remove(): Promise<void>;
    /**
     * Takes the frame's errors, null when one is gone, for the page to show
     * where it likes; without it they show under the frame.
     */
    onError?: (message: string | null) => void;
    /** What the page adds over a frame with a picture, given the image it shows. */
    children?: (src: string) => ComponentChildren;
}

/** An image on its way to the server, shown in the frame meanwhile. */
interface Upload {
    /** An object URL of the image. */
    url: string;
    /** The picture before the upload: the preview stays until the saved one changes. */
    from: string | null;
    sending: boolean;
}

export function CropFrame(props: CropFrameProps) {
    const { name, title, saved, canEdit, children } = props;
    const [upload, setUpload] = useState<Upload | null>(null);
    const [error, setErrorState] = useState<string | null>(null);
    const setError = (message: string | null) => {
        setErrorState(message);
        props.onError?.(message);
    };
    /** The crop window, open on a file or on the saved picture; a new key opens it anew. */
    const [editing, setEditing] = useState<{ file: File | null; key: number } | null>(null);
    const [dropping, setDropping] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const cell = useRef<HTMLDivElement>(null);
    const backdropPress = useRef(false);

    // Until the new picture comes, the frame would show the old one again.
    useEffect(() => {
        if (upload && !upload.sending && saved !== upload.from) setUpload(null);
    }, [saved, upload]);
    useEffect(() => {
        if (!upload) return;
        const { url } = upload;
        return () => URL.revokeObjectURL(url);
    }, [upload?.url]);

    const send = (image: Blob) => {
        const url = URL.createObjectURL(image);
        const current = (u: Upload | null) => u?.url === url;
        setError(null);
        setUpload({ url, from: saved, sending: true });
        props.upload(image).then(
            () => setUpload(u => current(u) ? { ...u!, sending: false } : u),
            (err: unknown) => {
                setUpload(u => current(u) ? null : u);
                setError(err instanceof Error ? err.message : String(err));
            },
        );
    };

    /** Opens the crop window on `file`, a picked or dropped image, or on the saved picture when null. */
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
        props.remove().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };

    const onPicked = (e: JSX.TargetedEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        const file = input.files?.[0] ?? null;
        // The same file picked again must fire change again.
        input.value = "";
        if (file) edit(file);
    };

    const src = upload?.url ?? saved;
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
        <div ref={cell} class={`crop-cell ${name}-cell`} data-id={name}>
            {src
                ? (
                    <div class={`crop-box ${name}${state}`} title={editable ? props.editHint : undefined} {...frameProps}>
                        <img src={src} alt={title} />
                        {upload?.sending && <div class="spinner" />}
                        {editable && <div class="edit-strip">{`✎ ${t("common.edit")}`}</div>}
                        {children?.(src)}
                    </div>
                )
                : (
                    <div class={`crop-box ${name} empty${state}`} title={props.uploadHint} {...frameProps}>{`+ ${title}`}</div>
                )}
            {canEdit && <input ref={picker} type="file" accept={ACCEPT} hidden onChange={onPicked} />}
            {error && !props.onError && <div class={`crop-error ${name}-error`}>{error}</div>}
            {canEdit && editing && (
                // The popover wraps the window exactly, except where a page lays the window over the
                // screen (the avatar on a phone, account.css): there it is the backdrop, and a tap on it
                // closes the window. CropEditor leaves presses inside the cell alone; a drag from the
                // window that ends on the backdrop is no tap.
                <div class={`crop-popover ${name}-pop`}
                    onPointerDown={e => {
                        backdropPress.current = e.target === e.currentTarget;
                    }}
                    onClick={e => {
                        if (backdropPress.current && e.target === e.currentTarget) setEditing(null);
                    }}>
                    <CropEditor key={editing.key} geometry={props.geometry} title={title} confirmDelete={props.confirmDelete} previews={props.previews}
                        file={editing.file} saved={saved} anchor={cell}
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
