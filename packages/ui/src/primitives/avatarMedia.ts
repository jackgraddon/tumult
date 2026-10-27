import type { MediaResolver } from "../media.ts";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const PX: Record<AvatarSize, number> = { xs: 16, sm: 24, md: 32, lg: 48 };

export interface AvatarMediaInput {
    src: string | null | undefined;
    size?: AvatarSize | undefined;
    resolveMedia: MediaResolver | undefined;
}

/**
 * Resolves an avatar's display URL for a changing `(src, size)` pair, guarded
 * by a monotonically increasing request id.
 *
 * The component (an SFC) watches `src` + `size` and calls {@link run} on each
 * change; a settle only commits while its id is still the latest — so a slow
 * earlier request can't clobber a newer one, an "outdated" resolution becoming a
 * harmless no-op — yet a *settled-and-current* request always commits.
 *
 * The id (and not a lifecycle-cleanup flag) is deliberate: the very first, cold
 * request must always be able to commit. A "stale on cleanup" guard instead raced
 * a cold settle through a multi-flush mount and discarded it — the rail's guild
 * avatars stayed on their initials until some later re-render happened to re-fire
 * the resolution. With the id, the cold request settles and commits on its own.
 *
 * Kept here as plain logic rather than inside the SFC so the request-id
 * discipline is unit-testable without a rendered component: `node --test` cannot
 * import a `.vue` file (only Vite compiles one).
 */
export class AvatarMedia {
    private request = 0;
    private readonly commit: (url: string | null) => void;

    constructor(commit: (url: string | null) => void) {
        this.commit = commit;
    }

    run(input: AvatarMediaInput): void {
        const id = ++this.request;
        this.commit(null);
        const { src, size, resolveMedia } = input;
        if (!src) return;
        if (!src.startsWith("mxc://")) {
            if (id === this.request) this.commit(src);
            return;
        }
        if (!resolveMedia) return;
        resolveMedia(src, PX[size ?? "md"]).then(
            (url) => {
                if (id === this.request) this.commit(url);
            },
            () => {
                // A terminal failure leaves the initials fallback in place.
            },
        );
    }
}
