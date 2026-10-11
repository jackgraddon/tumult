import { inject, type InjectionKey } from "vue";
import type { EncryptedAttachment } from "@tumult/core";

/** Resolve an `mxc://` URI to a loadable URL at `size` CSS px. */
export type MediaResolver = (uri: string, size: number) => Promise<string>;

/** Resolve an encrypted attachment descriptor to a loadable URL. */
export type EncryptedMediaResolver = (file: EncryptedAttachment) => Promise<string>;

/** Resolve an `mxc://` URI to the full (unresized) media as a loadable URL. */
export type MediaDownloadResolver = (uri: string) => Promise<string>;

/**
 * Provided by TumultShell from `client.resolveMedia`. Optional: outside a
 * shell (tests, stories) avatars without a resolver simply show initials.
 */
export const MediaKey: InjectionKey<MediaResolver> = Symbol("tumult/media");

/**
 * Provided by TumultShell from `client.resolveEncryptedMedia`. Optional:
 * without it, encrypted attachments fall back to showing their filename.
 */
export const EncryptedMediaKey: InjectionKey<EncryptedMediaResolver> = Symbol("tumult/encrypted-media");

/**
 * Provided by TumultShell from `client.resolveMediaDownload`. Optional:
 * non-image attachments (`m.video`/`m.audio`/`m.file`) fall back to showing
 * their filename, because they cannot use the thumbnail pipeline.
 */
export const MediaDownloadKey: InjectionKey<MediaDownloadResolver> = Symbol("tumult/media-download");

export function useMediaResolver(): MediaResolver | undefined {
    return inject(MediaKey, undefined);
}

export function useEncryptedMediaResolver(): EncryptedMediaResolver | undefined {
    return inject(EncryptedMediaKey, undefined);
}

export function useMediaDownloadResolver(): MediaDownloadResolver | undefined {
    return inject(MediaDownloadKey, undefined);
}
