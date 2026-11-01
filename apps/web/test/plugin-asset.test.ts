/**
 * The plugin-asset proxy's size ceiling (`api/plugin-asset.ts`). Hermetic: the
 * handler is driven with a stubbed `fetch` and a recording response, so no
 * network and no Vercel runtime are involved.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import handler, { MAX_ASSET_BYTES, readCapped } from "../api/plugin-asset.ts";

/** A body delivered in `chunks` pieces of `size` bytes, counting how many were pulled. */
function chunked(chunks: number, size: number): { body: ReadableStream<Uint8Array>; pulled: () => number } {
    let pulled = 0;
    // highWaterMark 0: pull only on a read, so `pulled` counts what the code read.
    const body = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (pulled === chunks) return controller.close();
                pulled++;
                controller.enqueue(new Uint8Array(size));
            },
        },
        { highWaterMark: 0 },
    );
    return { body, pulled: () => pulled };
}

interface Recorded {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}

function recorder(): { res: never; out: Recorded } {
    const out: Recorded = { status: 0, headers: {}, body: undefined };
    const res = {
        status(code: number) {
            out.status = code;
            return res;
        },
        setHeader(key: string, value: string) {
            out.headers[key.toLowerCase()] = value;
            return res;
        },
        json(value: unknown) {
            out.body = value;
            return res;
        },
        send(value: unknown) {
            out.body = value;
            return res;
        },
    };
    return { res: res as never, out };
}

const QUERY = { owner: "someone", repo: "plugin", tag: "v1.0.0", name: "plugin.js" };
const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe("readCapped", () => {
    it("returns the whole body under the limit", async () => {
        const { body } = chunked(3, 10);
        const buf = await readCapped(new Response(body), 30);
        assert.equal(buf?.length, 30);
    });

    it("stops reading once the limit is passed", async () => {
        const { body, pulled } = chunked(100, 10);
        assert.equal(await readCapped(new Response(body), 25), null);
        assert.ok(pulled() < 100, `read ${pulled()} of 100 chunks; it must stop at the limit`);
    });
});

describe("plugin-asset handler", () => {
    it("refuses a declared oversize asset with 413, before reading it", async () => {
        const { body, pulled } = chunked(1, 1);
        globalThis.fetch = async () =>
            new Response(body, { headers: { "content-length": String(MAX_ASSET_BYTES + 1) } });
        const { res, out } = recorder();
        await handler({ method: "GET", query: QUERY } as never, res);
        assert.equal(out.status, 413);
        assert.equal(out.headers["cache-control"], "no-store");
        assert.equal(pulled(), 0);
    });

    it("refuses an undeclared oversize asset with 413", async () => {
        const { body } = chunked(5, 1024 * 1024);
        globalThis.fetch = async () => new Response(body);
        const { res, out } = recorder();
        await handler({ method: "GET", query: QUERY } as never, res);
        assert.equal(out.status, 413);
        assert.equal(out.headers["content-length"], undefined, "a 413 must not carry the asset's length");
    });

    it("relays an asset under the ceiling with its real length", async () => {
        globalThis.fetch = async () =>
            new Response("export default {}", { headers: { "content-type": "text/javascript" } });
        const { res, out } = recorder();
        await handler({ method: "GET", query: QUERY } as never, res);
        assert.equal(out.status, 200);
        assert.equal(out.headers["content-type"], "text/javascript");
        assert.equal(out.headers["content-length"], "17");
        assert.equal(String(out.body), "export default {}");
    });
});
