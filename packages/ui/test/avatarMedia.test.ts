import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AvatarMedia } from "../src/primitives/avatarMedia.ts";
import type { MediaResolver } from "../src/media.ts";

/**
 * The guard for the rail-avatar regression: a guild tile is mounted from the
 * cached room list on the very first frame, *before* the MatrixClient's media
 * resolver exists, and its cold resolution only settles once start() finishes.
 * The tile must paint the picture when it finally settles — not be stuck on its
 * initials "stale on cleanup". These exercises the request-id discipline without
 * a rendered component (`node --test` can't import the `.vue`).
 */

/** A resolver whose promise we drive by hand, one controllable handle per call. */
function drivenResolver() {
    interface Handle {
        uri: string;
        size: number;
        promise: Promise<string>;
        resolve: (url: string) => void;
        reject: (err: unknown) => void;
    }
    const handles: Handle[] = [];
    let last: Handle | null = null;
    const calls: string[] = [];
    const resolveMedia: MediaResolver = (uri, size) => {
        let resolve!: (url: string) => void;
        let reject!: (err: unknown) => void;
        const promise = new Promise<string>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const h: Handle = { uri, size, promise, resolve, reject };
        handles.push(h);
        last = h;
        calls.push(uri);
        return promise;
    };
    return { resolveMedia, calls, handles, last: () => last };
}

function commits() {
    const seen: string[] = [];
    return {
        seen,
        commit: (url: string | null) => seen.push(url === null ? "∅" : url),
    };
}

describe("AvatarMedia request-id discipline", () => {
    it("a cold resolve settles and commits even when nothing re-fires", async () => {
        // This is the regression itself: the mxc fetch is issued at mount and
        // settles only later (after start()), with no second run to rescue it.
        const r = drivenResolver();
        const c = commits();
        const media = new AvatarMedia(c.commit);
        media.run({ src: "mxc://hs/id", size: "lg", resolveMedia: r.resolveMedia });

        // Settle on a later turn, like a network response.
        r.last()!.resolve("blob:/id");
        await r.last()!.promise;

        // commit(null) on the run, then the settled URL — and nothing overwrote it.
        assert.deepEqual(c.seen, ["∅", "blob:/id"]);
    });

    it("a superseding request makes the slower earlier settle a no-op", async () => {
        const r = drivenResolver();
        const c = commits();
        const media = new AvatarMedia(c.commit);

        const cold = media.run.bind(media);
        cold({ src: "mxc://hs/old", size: "lg", resolveMedia: r.resolveMedia });
        // Re-source to a new mxc before the old one settles (a re-render / change).
        cold({ src: "mxc://hs/new", size: "lg", resolveMedia: r.resolveMedia });

        const old_ = r.handles[0];
        const next = r.handles[1];
        assert.ok(old_ && next);
        next.resolve("blob:/new"); // current request settles
        await next.promise;
        assert.deepEqual(c.seen, ["∅", "∅", "blob:/new"]);
        assert.equal(r.calls[1], "mxc://hs/new");

        // The outdated request settles after the current one: it must not clobber.
        old_.resolve("blob:/old");
        await old_.promise;
        assert.deepEqual(c.seen, ["∅", "∅", "blob:/new"], "a stale settle is a no-op");
    });

    it("a non-mxc URL passes through synchronously", () => {
        const r = drivenResolver();
        const c = commits();
        const media = new AvatarMedia(c.commit);
        media.run({ src: "https://x/a.png", size: "md", resolveMedia: r.resolveMedia });
        assert.deepEqual(c.seen, ["∅", "https://x/a.png"]);
        assert.equal(r.calls.length, 0, "a passthrough never touches the resolver");
    });

    it("a terminal rejection leaves the fallback (commits no URL)", async () => {
        const r = drivenResolver();
        const c = commits();
        const media = new AvatarMedia(c.commit);
        media.run({ src: "mxc://hs/gone", size: "md", resolveMedia: r.resolveMedia });
        r.last()!.reject(new Error("M_NOT_FOUND"));
        // The resolver's promise is rejected but AvatarMedia consumes it; flush the
        // microtasks without awaiting it (which would throw in the test).
        await new Promise((res) => setTimeout(res, 0));
        // Only the null from the run: a terminal failure keeps initials, never a URL.
        assert.deepEqual(c.seen, ["∅"]);
    });

    it("a missing src or a missing resolver commits null and never hangs", () => {
        const c = commits();
        const media = new AvatarMedia(c.commit);
        media.run({ src: null, size: "md", resolveMedia: undefined });
        assert.deepEqual(c.seen, ["∅"]);
        // mxc with no resolver available (outside a shell): fallback stays, no throw.
        media.run({ src: "mxc://hs/id", size: "md", resolveMedia: undefined });
        assert.deepEqual(c.seen, ["∅", "∅"]);
    });

    it("defaults the size to md when none is given", () => {
        const r = drivenResolver();
        const c = commits();
        const media = new AvatarMedia(c.commit);
        media.run({ src: "mxc://hs/id", resolveMedia: r.resolveMedia });
        // 32 is the md request id in the resolver call.
        assert.equal(r.handles[0]?.size, 32);
        r.last()!.reject(new Error("stop")); // just settle so the promise doesn't dangle
        void r.last()!.promise;
    });
});
