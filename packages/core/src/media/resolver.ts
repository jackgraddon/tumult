import { Method, type MatrixClient } from "matrix-js-sdk";

import { decryptAttachment, type EncryptedAttachment } from "./attachment.ts";
import { isTerminalMediaError } from "./classify.ts";

/** Thumbnails are requested at 2x for HiDPI, capped so a typo can't pull a full image. */
const MAX_THUMBNAIL = 1024;

/**
 * Cap on remembered terminal failures. Scrolling deep history can 404 a lot of
 * purged media; the oldest entries fall off so the map cannot grow unbounded.
 */
const MAX_TERMINAL = 500;

/** Parse `mxc://server/mediaId`. Exported for tests. */
export function parseMxc(uri: string): { server: string; mediaId: string } | null {
    const match = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(uri);
    if (!match?.[1] || !match[2]) return null;
    return { server: match[1], mediaId: match[2] };
}

/**
 * Turns `mxc://` URIs into something an `<img>`/`<video>` can load.
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
 * One promise per request identity, shared by every render showing that media.
 * Transient failures are evicted so a later render retries; terminal ones
 * (4xx — see {@link isTerminalMediaError}) are remembered and never retried,
 * because a timeline rebuild used to re-fetch every permanently-missing image
 * on every rebuild. `dispose()` forgets both and revokes every blob URL — call
 * it on stop, when no rendered media can still need them.
 */
export class MediaResolver {
    private readonly matrix: MatrixClient;
    private readonly cache = new Map<string, Promise<string>>();
    /** Request identities whose fetch failed terminally — never retried while this resolver lives. */
    private readonly terminal = new Map<string, Error>();
    private readonly objectUrls = new Set<string>();
    private authenticated: Promise<boolean> | null = null;
    private disposed = false;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
    }

    /** Resolve to a thumbnail `size` CSS px wide, for images and avatars. */
    public resolve(uri: string, size: number): Promise<string> {
        // Already-resolvable URLs (fixtures, data:, https:) pass straight through.
        if (!uri.startsWith("mxc://")) return Promise.resolve(uri);
        const px = Math.min(MAX_THUMBNAIL, Math.max(1, Math.round(size)));
        return this.lookup(`${uri}@${px}`, uri, () => this.load(uri, px));
    }

    /**
     * Fetch the full (unresized) media bytes, for download links and native
     * `<video>`/`<audio>` playback.
     *
     * Non-image attachments must NOT go through `/thumbnail`: that endpoint is
     * an image pipeline and answers 400 for formats it cannot render (mp4,
     * arbitrary files), so asking it for a video both fails and logs.
     */
    public resolveDownload(uri: string): Promise<string> {
        if (!uri.startsWith("mxc://")) return Promise.resolve(uri);
        return this.lookup(`dl:${uri}`, uri, () => this.loadDownload(uri));
    }

    /**
     * Fetch and decrypt an encrypted attachment (the `file` descriptor on an
     * encrypted `m.room.message`). Returns a `blob:` URL of the plaintext.
     */
    public resolveEncrypted(file: EncryptedAttachment): Promise<string> {
        return this.lookup(`enc:${file.url}`, file.url, () => this.loadEncrypted(file));
    }

    public dispose(): void {
        this.disposed = true;
        for (const url of this.objectUrls) URL.revokeObjectURL(url);
        this.objectUrls.clear();
        this.cache.clear();
        this.terminal.clear();
    }

    /**
     * One promise per key. On failure the cache entry is dropped so a later
     * render can retry — unless the failure is terminal, in which case it is
     * remembered and every later call rejects without touching the network.
     */
    private lookup(key: string, uri: string, load: () => Promise<string>): Promise<string> {
        const known = this.terminal.get(key);
        if (known) return Promise.reject(known);

        let pending = this.cache.get(key);
        if (!pending) {
            pending = load().catch((error: unknown) => {
                this.cache.delete(key);
                if (isTerminalMediaError(error)) {
                    this.rememberTerminal(key, uri, error);
                } else {
                    console.warn("[tumult] media fetch failed; will retry", uri, error);
                }
                throw error;
            });
            this.cache.set(key, pending);
        }
        return pending;
    }

    private rememberTerminal(key: string, uri: string, error: unknown): void {
        console.warn("[tumult] media unavailable", uri, error);
        this.terminal.set(key, error instanceof Error ? error : new Error(String(error)));
        if (this.terminal.size > MAX_TERMINAL) {
            const oldest = this.terminal.keys().next().value;
            if (oldest !== undefined) this.terminal.delete(oldest);
        }
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
        return this.toObjectUrl(blob);
    }

    private async loadDownload(uri: string): Promise<string> {
        return this.toObjectUrl(await this.fetchBlob(uri));
    }

    private async loadEncrypted(file: EncryptedAttachment): Promise<string> {
        const ciphertext = await (await this.fetchBlob(file.url)).arrayBuffer();
        // Decrypt before minting a URL: a hash mismatch must not look like success.
        if (this.disposed) throw new Error("Media resolver disposed");
        const plaintext = await decryptAttachment(file, ciphertext);
        return this.toObjectUrl(new Blob([plaintext]));
    }

    /** Fetch the full media bytes, authenticated where the server supports it. */
    private async fetchBlob(uri: string): Promise<Blob> {
        const parsed = parseMxc(uri);
        if (!parsed) throw new Error(`Not a valid mxc URI: ${uri}`);

        this.authenticated ??= this.matrix.isVersionSupported("v1.11").catch(() => false);
        if (await this.authenticated) {
            return this.matrix.http.authedRequest<Blob>(
                Method.Get,
                `/download/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.mediaId)}`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1/media", rawResponseBody: true },
            );
        }

        const legacy = this.matrix.mxcUrlToHttp(uri, undefined, undefined, undefined, false, true, true);
        if (!legacy) throw new Error(`Cannot resolve ${uri}`);
        const response = await fetch(legacy);
        if (!response.ok) {
            // Carry the status so the failure is classified like an SDK error.
            throw Object.assign(new Error(`Failed to fetch ${uri}: ${response.status}`), {
                httpStatus: response.status,
            });
        }
        return response.blob();
    }

    private toObjectUrl(blob: Blob): string {
        // Stopped while this was in flight: don't mint a URL nothing will revoke.
        if (this.disposed) throw new Error("Media resolver disposed");
        const url = URL.createObjectURL(blob);
        this.objectUrls.add(url);
        return url;
    }
}
