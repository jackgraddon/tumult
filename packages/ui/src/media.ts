import { inject, type InjectionKey } from "vue";
import type { EncryptedAttachment } from "@tumult/core";

/** Resolve an `mxc://` URI to a loadable URL at `size` CSS px. */
export type MediaResolver = (uri: string, size: number) => Promise<string>;

/** Resolve an encrypted attachment descriptor to a loadable URL. */
export type EncryptedMediaResolver = (file: EncryptedAttachment) => Promise<string>;

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

export function useMediaResolver(): MediaResolver | undefined {
    return inject(MediaKey, undefined);
}

export function useEncryptedMediaResolver(): EncryptedMediaResolver | undefined {
    return inject(EncryptedMediaKey, undefined);
}
