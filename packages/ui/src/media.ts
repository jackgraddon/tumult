import { inject, type InjectionKey } from "vue";

/** Resolve an `mxc://` URI to a loadable URL at `size` CSS px. */
export type MediaResolver = (uri: string, size: number) => Promise<string>;

/**
 * Provided by TumultShell from `client.resolveMedia`. Optional: outside a
 * shell (tests, stories) avatars without a resolver simply show initials.
 */
export const MediaKey: InjectionKey<MediaResolver> = Symbol("tumult/media");

export function useMediaResolver(): MediaResolver | undefined {
    return inject(MediaKey, undefined);
}
