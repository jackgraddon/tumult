import { uploadWithRefresh } from "../util/token-refresh.ts";
import type { MatrixClient } from "matrix-js-sdk";

import type { ProfileView } from "../contract.ts";

/**
 * A readable name for an unnamed user: the mxid localpart (`@alice:host` →
 * `alice`). Never invents a display name — it only restates the id we would
 * otherwise show raw.
 */
export function fallbackName(userId: string, displayName?: string | null): string {
    if (displayName && displayName !== userId) return displayName;
    if (userId.startsWith("@")) return userId.slice(1).split(":")[0] ?? userId;
    return userId;
}

/**
 * Read our own profile from the homeserver.
 *
 * Separate from the session on purpose: `SessionView` is the *identity* we
 * authenticated as (stable across renames), while this is the *profile* the
 * server currently has (renameable, avatarable).
 */
export async function readProfile(matrix: MatrixClient): Promise<ProfileView> {
    const userId = matrix.getUserId();
    if (!userId) throw new Error("No session");
    const info = await matrix.getProfileInfo(userId);
    return {
        userId,
        displayName: fallbackName(userId, info.displayname),
        avatarUrl: info.avatar_url || null,
    };
}

/**
 * Write our own profile to the homeserver.
 *
 * `displayName` goes through the profile endpoint (empty string clears it);
 * `avatar` is uploaded to the media repository first (`null` clears it to
 * ""). Each part is independent: a name that landed while the upload failed
 * is left as landed — the caller refreshes from the server so the feed shows
 * exactly that half-applied truth rather than pretending either way.
 */
export async function writeProfile(
    matrix: MatrixClient,
    params: { displayName?: string; avatar?: Blob | null },
): Promise<void> {
    if (params.displayName !== undefined) {
        await matrix.setDisplayName(params.displayName.trim());
    }
    if (params.avatar !== undefined) {
        if (params.avatar === null) {
            await matrix.setAvatarUrl("");
        } else {
            const { content_uri } = await uploadWithRefresh(matrix, params.avatar);
            await matrix.setAvatarUrl(content_uri);
        }
    }
}
