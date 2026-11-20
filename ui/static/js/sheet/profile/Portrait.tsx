// The portrait beside the character's name, only in the full sheet
// (CharacterInfo): the shared crop frame (crop/CropFrame.tsx) at 3:4, with
// ⤢ for the full size. The image is served by its hash, GET /portrait/:hash;
// the hash changes only with portraitChanged (core/remote.ts), also after this
// tab's own upload, so every tab shows the same.
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSheet } from "../components/context";
import { CropFrame } from "../../crop/CropFrame";
import type { CropGeometry } from "../../crop/crop";
import { t } from "../../i18n";

// The size the server takes (internal/webapp/portraits.go).
const PORTRAIT: CropGeometry = { stage: 300, frame: { w: 180, h: 240 }, output: { w: 360, h: 480 } };
const PREVIEWS = [90];

/** Whether CharacterInfo shows the portrait's cell: a viewer sees none on a sheet without one. */
export const showsPortrait = (portrait: string | null, canEdit: boolean) => portrait !== null || canEdit;

export function Portrait() {
    const { portrait, canEdit, actions } = useSheet();
    const hash = portrait.value;
    if (!showsPortrait(hash, canEdit)) return null;
    const title = t("sheet.profile.portrait.title");
    return (
        <CropFrame name="portrait" geometry={PORTRAIT} title={title} editHint={t("sheet.profile.portrait.edit")}
            uploadHint={t("sheet.profile.portrait.upload")} confirmDelete={t("sheet.profile.portrait.confirmDelete")} previews={PREVIEWS}
            saved={hash ? `/portrait/${hash}` : null} canEdit={canEdit}
            upload={image => actions.uploadPortrait(image)} remove={() => actions.deletePortrait()}>
            {src => <FullSizeButton src={src} />}
        </CropFrame>
    );
}

/** ⤢ in the frame's corner: opens the full size and not the crop window. */
function FullSizeButton({ src }: { src: string }) {
    const [full, setFull] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    useFullView(button, full ? src : null, () => setFull(false));
    return (
        <div class="corner">
            <button ref={button} type="button" class="portrait-full-open" title={t("sheet.profile.portrait.fullSize")} aria-label={t("sheet.profile.portrait.fullSize")}
                onClick={e => {
                    e.stopPropagation();
                    setFull(true);
                }}
                onKeyDown={e => e.stopPropagation()}>
                ⤢
            </button>
        </div>
    );
}

/**
 * Shows the full view of `src` while it is not null. It goes straight into
 * the sheet's shadow root: inside the tab panel, which is a stacking context
 * of its own, the sheet's controls would cover it.
 */
function useFullView(inside: { current: HTMLElement | null }, src: string | null, close: () => void): void {
    useEffect(() => {
        if (!src || !inside.current) return;
        const root = inside.current.getRootNode();
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
        <div class="portrait-full" role="dialog" aria-modal="true" aria-label={t("sheet.profile.portrait.title")}
            onClick={e => {
                if (e.target === e.currentTarget) close();
            }}>
            <figure>
                <button type="button" class="portrait-full-close" title={t("common.close")} aria-label={t("common.close")} onClick={close}>×</button>
                <img src={src} alt={t("sheet.profile.portrait.title")} />
            </figure>
        </div>
    );
}
