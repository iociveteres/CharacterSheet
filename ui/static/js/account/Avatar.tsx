// The avatar block of the Account page (ui/html/partials/avatar.html) with its
// script: the shared crop frame (crop/CropFrame.tsx) with a square frame and a
// 192×192 image, as the sheet's portrait, and the texts beside it. The image
// is public, served by its hash at GET /avatar/:hash; PUT and DELETE
// /account/avatar change it (internal/webapp/avatars.go).
import { useState } from "preact/hooks";
import { CropFrame } from "../crop/CropFrame";
import type { CropGeometry } from "../crop/crop";
import { t } from "../i18n";
import { stripJpegMetadata } from "./jpeg";

// The size and weight the server takes (avatarSide in internal/webapp/avatars.go, models.AvatarMaxBytes).
export const AVATAR: CropGeometry = { stage: 300, frame: { w: 240, h: 240 }, output: { w: 192, h: 192 }, maxBytes: 64 << 10 };
// Beside a post on the forum and on a phone.
const PREVIEWS = [96, 36];

const ERRORS: { [status: number]: string } = {
    400: t("account.avatar.errors.badImage"),
    403: t("account.avatar.errors.locked"),
    413: t("account.avatar.errors.tooLarge"),
};

/** PUT or DELETE /account/avatar; a PUT answers with the new image's URL. */
async function avatarRequest(method: "PUT" | "DELETE", csrf: string, image?: Blob): Promise<string | null> {
    let body = image;
    if (image?.type === "image/jpeg") {
        body = new Blob([stripJpegMetadata(new Uint8Array(await image.arrayBuffer()))], { type: image.type });
    }
    let res: Response;
    try {
        res = await fetch("/account/avatar", { method, body, headers: { "X-CSRF-Token": csrf } });
    } catch {
        throw new Error(t("account.avatar.errors.offline"));
    }
    if (!res.ok) throw new Error(ERRORS[res.status] ?? t("account.avatar.errors.refused", { status: res.status }));
    if (method === "DELETE") return null;
    const answer = await res.json() as { url: string };
    return answer.url;
}

export interface AvatarRowProps {
    /** The URL of the saved avatar, null without one. */
    saved: string | null;
    csrf: string;
}

/** The picture and the texts beside it: what the script draws in .avatar-row in place of the server's. */
export function AvatarRow(props: AvatarRowProps) {
    const [saved, setSaved] = useState(props.saved);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = async (image: Blob) => {
        setSaving(true);
        try {
            setSaved(await avatarRequest("PUT", props.csrf, image));
        } finally {
            setSaving(false);
        }
    };
    const remove = async () => {
        await avatarRequest("DELETE", props.csrf);
        setSaved(null);
    };

    const title = t("account.avatar.title");
    return (
        <>
            <CropFrame name="avatar" geometry={AVATAR} title={title} editHint={t("account.avatar.edit")}
                uploadHint={t("account.avatar.upload")} confirmDelete={t("account.avatar.confirmDelete")} previews={PREVIEWS}
                saved={saved} canEdit upload={upload} remove={remove} onError={setError} />
            <div class="avatar-side">
                <p>{saving ? t("account.avatar.saving") : saved ? t("account.avatar.public") : t("account.avatar.none")}</p>
                {error && <p class="avatar-error">{error}</p>}
                {!saving && <p class="hint">{t("account.avatar.formats")}</p>}
            </div>
        </>
    );
}
