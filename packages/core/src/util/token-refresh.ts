import type { MatrixClient } from "matrix-js-sdk";

/**
 * The shape two of our call sites need from an upload, without pulling the SDK's
 * private `UploadResponse` type out of a deep import here.
 */
interface UploadResponse {
    content_uri: string;
}

/**
 * Is this an expired-access-token rejection we can recover from?
 *
 * The homeserver signals a dead access token with `errcode` `M_UNKNOWN_TOKEN` on
 * an `httpStatus 401`. A 403/404/400/429/5xx is a genuine server/user error and
 * must propagate untouched. A `M_UNKNOWN_TOKEN` with no stamped status (the XHR
 * upload path sometimes omits `httpStatus`) is still a dead token, so it counts.
 */
export function isTokenRefreshError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const errcode = (error as { errcode?: unknown }).errcode;
    if (errcode !== "M_UNKNOWN_TOKEN") return false;
    const httpStatus = (error as { httpStatus?: unknown }).httpStatus;
    return typeof httpStatus !== "number" || httpStatus === 401;
}

/**
 * Upload a file through the media repository, recovering once from a dead access
 * token.
 *
 * The SDK fetch transport refreshes and retries on `M_UNKNOWN_TOKEN`, but the
 * media repository's `uploadContent` goes out over XHR, whose 401 lands as a
 * dead-end straight at the caller. Forcing a refresh first would still reuse the
 * same dead token if we just retried, so: force one MAS refresh through the SDK's
 * `refreshToken()` (which applies the new access token to the client and
 * persists the rotated refresh token via `onTokenRefresh`), then retry the
 * upload a single time. One refresh, one retry — never a loop.
 *
 * A client with no refresh token to begin with cannot recover, so the original
 * error propagates. Any non-refreshable rejection passes through untouched.
 */
export async function uploadWithRefresh(
    matrix: MatrixClient,
    file: File | Blob,
): Promise<UploadResponse> {
    try {
        return await matrix.uploadContent(file);
    } catch (error) {
        if (!isTokenRefreshError(error)) throw error;
        const refreshToken = matrix.getRefreshToken();
        if (!refreshToken) throw error;
        await matrix.refreshToken(refreshToken);
        return await matrix.uploadContent(file);
    }
}
