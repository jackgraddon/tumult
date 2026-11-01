/**
 * The desktop's `/api/plugin-asset`: the web function's validation, URL and
 * size cap, answered as a fetch `Response`. Hermetic — `fetchImpl` is stubbed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ASSET_BYTES } from "../../web/api/plugin-asset.ts";
import { pluginAssetResponse } from "../src/plugin-asset.ts";

const QUERY = new URLSearchParams({ owner: "someone", repo: "plugin", tag: "v1.0.0", name: "plugin.js" });

describe("pluginAssetResponse", () => {
    it("fetches the reconstructed github.com URL and relays the bytes", async () => {
        const seen: string[] = [];
        const response = await pluginAssetResponse("GET", QUERY, async (input) => {
            seen.push(input);
            return new Response("export default {}", { headers: { "content-type": "text/javascript" } });
        }, { "X-Content-Type-Options": "nosniff" });
        assert.deepEqual(seen, ["https://github.com/someone/plugin/releases/download/v1.0.0/plugin.js"]);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "text/javascript");
        assert.equal(response.headers.get("content-length"), "17");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(await response.text(), "export default {}");
    });

    it("rejects invalid segments before fetching anything", async () => {
        const cases: [Record<string, string>, string][] = [
            [{ owner: "-bad" }, "Invalid owner"],
            [{ owner: "a/b" }, "Invalid owner"],
            [{ repo: "../x" }, "Invalid repo"],
            [{ tag: "" }, "Invalid tag"],
            [{ name: "noextension" }, "Invalid asset name"],
            [{ name: "a/b.js" }, "Invalid asset name"],
        ];
        for (const [override, error] of cases) {
            const query = new URLSearchParams({ ...Object.fromEntries(QUERY), ...override });
            const response = await pluginAssetResponse("GET", query, async () => assert.fail("fetched despite invalid input"));
            assert.equal(response.status, 400, JSON.stringify(override));
            assert.deepEqual(await response.json(), { error });
        }
    });

    it("rejects a repeated parameter (it arrives as a list, as on Vercel)", async () => {
        const query = new URLSearchParams(QUERY);
        query.append("owner", "other");
        const response = await pluginAssetResponse("GET", query, async () => assert.fail("fetched"));
        assert.equal(response.status, 400);
    });

    it("allows GET only", async () => {
        const response = await pluginAssetResponse("POST", QUERY, async () => assert.fail("fetched"));
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET");
    });

    it("refuses an oversize asset with 413", async () => {
        const response = await pluginAssetResponse("GET", QUERY, async () =>
            new Response("x", { headers: { "content-length": String(MAX_ASSET_BYTES + 1) } }),
        );
        assert.equal(response.status, 413);
        assert.equal(response.headers.get("cache-control"), "no-store");
    });

    it("passes an upstream failure through as JSON", async () => {
        const response = await pluginAssetResponse("GET", QUERY, async () => new Response("nope", { status: 404 }));
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "Upstream returned 404" });
    });
});
