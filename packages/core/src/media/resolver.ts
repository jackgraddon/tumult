import { Method, type MatrixClient } from "matrix-js-sdk";

import { decryptAttachment, type EncryptedAttachment } from "./attachment.ts";

/** Thumbnails are requested at 2x for HiDPI, capped so a typo can't pull a full image. */
const MAX_THUMBNAIL = 1024;

/** Parse `mxc://server/mediaId`. Exported for tests. */
export function parseMxc(uri: string): { server: string; mediaId: string } | null {
    const match = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(uri);
    if (!match?.[1] || !match[2]) return null;
    return { server: match[1], mediaId: match[2] };
}

/**
 * Turns `mxc://` URIs into something an `<img>` can load.
 *
 * Authenticated media (spec v1.11, MSC3916) moved downloads under
 * `/_matrix/client/v1/media/*` and requires an access token. Synapse >= 1.120
 * enables it by default and 404s media uploaded after that on the old
 * unauthenticated `/_matrix/media/v3/*` endpoints — which is what plain
 * `mxcUrlToHttp()` URLs point at. `<img>` cannot send an Authorization header,
 * so the bytes are fetched here and handed to the UI as a `blob:` URL.
 *
 * The fetch goes through the SDK's `authedRequest`, not a bare `fetch`, so an
 * expired access token is refreshed (and retried) instead of 401ing. Servers
 * without v1.11 fall back to the legacy direct URL.
 *
 * One promise per (uri, size), shared by every avatar showing that image;
 * failures are evicted so a later render can retry. `dispose()` revokes every
 * blob URL — call it on stop, when no rendered image can still need them.
 */
export class MediaResolver {
    private readonly matrix: MatrixClient;
    private readonly cache = new Map<string, Promise<string>>();
    private readonly objectUrls = new Set<string>();
    private authenticated: Promise<boolean> | null = null;
    private disposed = false;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
    }

    public resolve(uri: string, size: number): Promise<string> {
        // Already-resolvable URLs (fixtures, data:, https:) pass straight through.
        if (!uri.startsWith("mxc://")) return Promise.resolve(uri);
        const px = Math.min(MAX_THUMBNAIL, Math.max(1, Math.round(size)));
        const key = `${uri}@${px}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.load(uri, px).catch((error: unknown) => {
                this.cache.delete(key);
                throw error;
            });
            this.cache.set(key, pending);
        }
        return pending;
    }

    /**
     * Fetch and decrypt an encrypted attachment (the `file` descriptor on an
     * encrypted `m.room.message`). Returns a `blob:` URL of the plaintext.
     */
    public resolveEncrypted(file: EncryptedAttachment): Promise<string> {
        const key = `enc:${file.url}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.loadEncrypted(file).catch((error: unknown) => {
                this.cache.delete(key);
                throw error;
            });
            this.cache.set(key, pending);
        }
        return pending;
    }

    public dispose(): void {
        this.disposed = true;
        for (const url of this.objectUrls) URL.revokeObjectURL(url);
        this.objectUrls.clear();
        this.cache.clear();
    }

    private async load(uri: string, px: number): Promise<string> {
        const parsed = parseMxc(uri);
        if (!parsed) throw new Error(`Not a valid mxc URI: ${uri}`);

        this.authenticated ??= this.matrix.isVersionSupported("v1.11").catch(() => false);
        if (!(await this.authenticated)) {
            const legacy = this.matrix.mxcUrlToHttp(uri, px, px, "scale");
            if (!legacy) throw new Error(`Cannot resolve ${uri}`);
            return legacy;
        }

        const blob = await this.matrix.http.authedRequest<Blob>(
            Method.Get,
            `/thumbnail/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.mediaId)}`,
            { width: String(px), height: String(px), method: "scale" },
            undefined,
            { prefix: "/_matrix/client/v1/media", rawResponseBody: true },
        );
        // Stopped while this was in flight: don't mint a URL nothing will revoke.
        if (this.disposed) throw new Error("Media resolver disposed");
        const url = URL.createObjectURL(blob);
        this.objectUrls.add(url);
        return url;
    }

    private async loadEncrypted(file: EncryptedAttachment): Promise<string> {
        const parsed = parseMxc(file.url);
        if (!parsed) throw new Error(`Not a valid mxc URI: ${file.url}`);

        this.authenticated ??= this.matrix.isVersionSupported("v1.11").catch(() => false);
        let ciphertext: ArrayBuffer;
        if (await this.authenticated) {
            const blob = await this.matrix.http.authedRequest<Blob>(
                Method.Get,
                `/download/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.mediaId)}`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1/media", rawResponseBody: true },
            );
            ciphertext = await blob.arrayBuffer();
        } else {
            const legacy = this.matrix.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
            if (!legacy) throw new Error(`Cannot resolve ${file.url}`);
            const response = await fetch(legacy);
            if (!response.ok) throw new Error(`Failed to fetch ${file.url}: ${response.status}`);
            ciphertext = await response.arrayBuffer();
        }

        if (this.disposed) throw new Error("Media resolver disposed");
        const plaintext = await decryptAttachment(file, ciphertext);
        const url = URL.createObjectURL(new Blob([plaintext]));
        this.objectUrls.add(url);
        return url;
    }
}
