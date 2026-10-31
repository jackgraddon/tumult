import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient, Method } from "matrix-js-sdk";

/**
 * Guards patches/matrix-js-sdk@43.0.0.patch. Upstream's request timeout
 * (`timeoutSignal`) never clears its timer, so every request with a local
 * timeout left one running for the whole timeout — 110 s per /sync — which kept
 * Node processes alive after stopClient() (found by a handle diagnostic on the
 * integration suite). pnpm keys a patch to the exact version, so an SDK upgrade
 * silently drops it: this test is what notices.
 */
describe("matrix-js-sdk request timeout (patched)", () => {
    it("leaves no timer behind once a request has settled", async () => {
        const server = createServer((_req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const { port } = server.address() as AddressInfo;
            const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
            const timers = (): number => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
            const before = timers();
            await client.http.request(Method.Get, "/anything", undefined, undefined, { localTimeoutMs: 60_000 });
            assert.equal(
                timers(),
                before,
                "the request's 60 s timeout timer outlived it: patches/matrix-js-sdk@*.patch is not applied (SDK upgraded?)",
            );
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
