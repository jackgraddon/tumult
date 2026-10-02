import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { MediaResolver, parseMxc } from "../src/media/resolver.ts";

interface Call {
    path: string;
    query: Record<string, string>;
    opts: Record<string, unknown>;
}

function stub(opts: { v111?: boolean; fail?: number } = {}) {
    const calls: Call[] = [];
    let failures = opts.fail ?? 0;
    const matrix = {
        isVersionSupported: async (v: string) => v === "v1.11" && (opts.v111 ?? true),
        mxcUrlToHttp: (uri: string, w: number) => `https://legacy/${uri.slice(6)}?w=${w}`,
        http: {
            authedRequest: async (_m: string, path: string, query: Record<string, string>, _b: unknown, o: Record<string, unknown>) => {
                calls.push({ path, query, opts: o });
                if (failures-- > 0) throw new Error("boom");
                return new Blob(["png"], { type: "image/png" });
            },
        },
    } as unknown as MatrixClient;
    return { matrix, calls };
}

describe("MediaResolver", () => {
    it("parses mxc URIs and rejects malformed ones", () => {
        assert.deepEqual(parseMxc("mxc://example.org/abc123"), { server: "example.org", mediaId: "abc123" });
        assert.equal(parseMxc("mxc://example.org/"), null);
        assert.equal(parseMxc("https://x/y"), null);
    });

    it("passes non-mxc URLs straight through", async () => {
        assert.equal(await new MediaResolver(stub().matrix).resolve("https://x/a.png", 48), "https://x/a.png");
    });

    it("fetches through the authenticated v1 endpoint as a blob URL, once per size", async () => {
        const { matrix, calls } = stub();
        const resolver = new MediaResolver(matrix);
        const [a, b] = await Promise.all([resolver.resolve("mxc://hs/id", 96), resolver.resolve("mxc://hs/id", 96)]);
        assert.ok(a.startsWith("blob:"));
        assert.equal(a, b);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.path, "/thumbnail/hs/id");
        assert.equal(calls[0]?.opts["prefix"], "/_matrix/client/v1/media");
        assert.equal(calls[0]?.opts["rawResponseBody"], true);
        assert.deepEqual(calls[0]?.query, { width: "96", height: "96", method: "crop" });
        resolver.dispose();
    });

    it("falls back to the legacy URL on servers without v1.11", async () => {
        const { matrix, calls } = stub({ v111: false });
        assert.equal(await new MediaResolver(matrix).resolve("mxc://hs/id", 48), "https://legacy/hs/id?w=48");
        assert.equal(calls.length, 0);
    });

    it("evicts failures so a later render retries", async () => {
        const { matrix, calls } = stub({ fail: 1 });
        const resolver = new MediaResolver(matrix);
        await assert.rejects(resolver.resolve("mxc://hs/id", 48));
        assert.ok((await resolver.resolve("mxc://hs/id", 48)).startsWith("blob:"));
        assert.equal(calls.length, 2);
        resolver.dispose();
    });

    it("caps thumbnail size", async () => {
        const { matrix, calls } = stub();
        const resolver = new MediaResolver(matrix);
        await resolver.resolve("mxc://hs/id", 10_000);
        assert.equal(calls[0]?.query["width"], "256");
        resolver.dispose();
    });
});
