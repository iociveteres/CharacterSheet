// The portrait window: a popover beside the portrait where the image is moved
// and zoomed under a 3:4 frame, replaced by another file or deleted. The crop
// itself is portraitCrop.ts. The original file is not kept: a saved portrait
// opens as its 360×480 image, which can be zoomed into but not widened.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JSX, RefObject } from "preact";
import {
    drawCrop, encodePortrait, FRAME, initialCrop, MAX_ZOOM, moveCrop, OUTPUT, sameCrop, scaleOf, STAGE, zoomCrop,
    type Crop, type Size,
} from "../portraitCrop";

export const NOT_AN_IMAGE = "Not an image: choose a PNG, JPEG or WebP file.";

/** Whether `file` may be an image the browser can open; the window says so when it cannot. */
export const isImageFile = (file: File) => file.type.startsWith("image/");

export interface PortraitEditorProps {
    /** A file the user picked or dropped; null opens the saved portrait. */
    file: File | null;
    /** The URL of the saved portrait, null without one: then there is nothing to delete. */
    saved: string | null;
    /** The portrait's cell: a press inside it does not close the window. */
    anchor: RefObject<HTMLElement>;
    onSave(image: Blob): void;
    onDelete(): void;
    onClose(): void;
}

/** What the window crops: its URL, and whether it is a new file rather than the saved portrait. */
interface Source {
    url: string;
    file: boolean;
}

/** The image as it lies on the stage, once it has loaded. */
interface Loaded {
    size: Size;
    initial: Crop;
}

const WHEEL_STEP = 1.08;

export function PortraitEditor({ file, saved, anchor, onSave, onDelete, onClose }: PortraitEditorProps) {
    const [source, setSource] = useState<Source | null>(() =>
        file ? { url: URL.createObjectURL(file), file: true } : saved ? { url: saved, file: false } : null);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [crop, setCrop] = useState<Crop | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);
    const pop = useRef<HTMLDivElement>(null);
    const image = useRef<HTMLImageElement>(null);
    const preview = useRef<HTMLCanvasElement>(null);
    const picker = useRef<HTMLInputElement>(null);
    const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);

    // An object URL of a file lives as long as the window shows it.
    useEffect(() => {
        if (!source?.file) return;
        const { url } = source;
        return () => URL.revokeObjectURL(url);
    }, [source?.url]);

    // Esc in capture on window, stopped: the popup the sheet may be shown in closes on Esc too.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            onClose();
        };
        const onPress = (e: PointerEvent) => {
            const path = e.composedPath();
            if (pop.current && path.includes(pop.current)) return;
            if (anchor.current && path.includes(anchor.current)) return;
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", onPress, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", onPress, true);
        };
    }, []);

    useLayoutEffect(() => {
        if (loaded && crop && image.current && preview.current) drawCrop(preview.current, image.current, loaded.size, crop);
    }, [loaded, crop]);

    // The size the portrait will have, once the crop rests a moment: encoding on every move would stall the drag.
    const [weight, setWeight] = useState<string | null>(null);
    useEffect(() => {
        const canvas = preview.current;
        if (!loaded || !crop || !canvas?.toBlob) return;
        const timer = setTimeout(() => canvas.toBlob(blob => {
            setWeight(blob && `${blob.type.replace("image/", "").toUpperCase()} · ${(blob.size / 1024).toFixed(1)} KB`);
        }, "image/webp", 0.8), 150);
        return () => clearTimeout(timer);
    }, [loaded, crop]);

    const onLoad = () => {
        const img = image.current!;
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        const initial = initialCrop(size);
        setLoaded({ size, initial });
        setCrop(initial);
        setMessage(null);
    };

    const onError = () => {
        setLoaded(null);
        setCrop(null);
        setMessage(NOT_AN_IMAGE);
    };

    const choose = (e: JSX.TargetedEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        const picked = input.files?.[0];
        input.value = "";
        if (!picked) return;
        if (!isImageFile(picked)) {
            setMessage(NOT_AN_IMAGE);
            return;
        }
        setLoaded(null);
        setCrop(null);
        setMessage(null);
        setConfirming(false);
        setSource({ url: URL.createObjectURL(picked), file: true });
    };

    const save = () => {
        if (!loaded || !crop || !image.current) return;
        // Every save encodes the WebP again: an untouched saved portrait stays as it is.
        if (!source?.file && sameCrop(crop, loaded.initial)) {
            onClose();
            return;
        }
        setSaving(true);
        encodePortrait(image.current, loaded.size, crop).then(onSave, (err: unknown) => {
            setSaving(false);
            setMessage(err instanceof Error ? err.message : String(err));
        });
    };

    const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        if (!crop) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, crop };
    };
    const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        const from = drag.current;
        if (!from || !loaded) return;
        setCrop(moveCrop(loaded.size, from.crop, e.clientX - from.x, e.clientY - from.y));
    };
    const endDrag = () => {
        drag.current = null;
    };
    const onWheel = (e: JSX.TargetedWheelEvent<HTMLDivElement>) => {
        if (!loaded || !crop) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        const zoom = crop.zoom * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
        setCrop(zoomCrop(loaded.size, crop, zoom, e.clientX - box.left, e.clientY - box.top));
    };

    const imageStyle = loaded && crop
        ? { transform: `translate(${crop.x}px, ${crop.y}px) scale(${scaleOf(loaded.size, crop.zoom)})` }
        : { visibility: "hidden" };

    return (
        <div ref={pop} class="crop-pop" role="dialog" aria-label="Portrait">
            <div class="crop-title">Portrait</div>
            <div class="crop-body">
                <div>
                    <div class="crop-stage" style={{ width: STAGE, height: STAGE }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                        onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={onWheel}>
                        {source && <img ref={image} key={source.url} src={source.url} alt="" style={imageStyle} onLoad={onLoad} onError={onError} />}
                        <div class="crop-frame" style={{ left: FRAME.x, top: FRAME.y, width: FRAME.w, height: FRAME.h }} />
                    </div>
                    <label class="crop-zoom">
                        <span>−</span>
                        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop?.zoom ?? 1} disabled={!loaded} aria-label="Zoom"
                            onInput={e => loaded && crop && setCrop(zoomCrop(loaded.size, crop, Number(e.currentTarget.value)))} />
                        <span>+</span>
                    </label>
                </div>
                <div class="crop-side">
                    <canvas ref={preview} width={OUTPUT.w} height={OUTPUT.h} />
                    <div class="crop-size">{`${OUTPUT.w}×${OUTPUT.h}`}{weight && ` · ${weight}`}</div>
                    <button type="button" class="crop-choose" onClick={() => picker.current?.click()}>Choose file…</button>
                    <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={choose} />
                    {message && <div class="crop-message">{message}</div>}
                </div>
            </div>
            <div class="crop-footer">
                {confirming
                    ? (
                        <>
                            <span class="question">Delete the portrait?</span>
                            <span class="spacer" />
                            <button type="button" class="crop-keep" onClick={() => setConfirming(false)}>Keep</button>
                            <button type="button" class="danger confirm crop-delete-yes" onClick={onDelete}>Delete</button>
                        </>
                    )
                    : (
                        <>
                            {saved && <button type="button" class="danger crop-delete" disabled={saving} onClick={() => setConfirming(true)}>Delete</button>}
                            <span class="spacer" />
                            <button type="button" class="crop-cancel" onClick={onClose}>Cancel</button>
                            <button type="button" class="primary crop-save" disabled={!loaded || saving} onClick={save}>Save</button>
                        </>
                    )}
            </div>
        </div>
    );
}
