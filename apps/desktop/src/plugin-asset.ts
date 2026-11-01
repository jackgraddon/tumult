/**
 * `app://tumult/api/plugin-asset` — the desktop's answer to the Vercel function
 * `apps/web/api/plugin-asset.ts`, which it reuses whole: the same query
 * validation, the same reconstructed github.com URL, the same size cap and
 * timeout. GitHub release assets are not CORS-fetchable from a page (AGENTS.md,
 * Plugins), and the main process is "server-side" in exactly the sense the
 * Vercel function is.
 */
import { fetchReleaseAsset, validateAssetQuery } from "../../web/api/plugin-asset.ts";
import type { AssetFetch } from "../../web/api/plugin-asset.ts";

/**
 * Answer one plugin-asset request. `fetchImpl` is Electron's `net.fetch` in
 * the app (Chromium's network stack, so the system proxy applies).
 */
export async function pluginAssetResponse(method: string, query: URLSearchParams, fetchImpl: AssetFetch, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...extraHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
        });

    if (method !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });

    // Repeated keys arrive as arrays, as Vercel parses them, so they fail the
    // same way (`typeof !== "string"`).
    const record: Record<string, string | string[]> = {};
    for (const key of new Set(query.keys())) {
        const values = query.getAll(key);
        record[key] = values.length === 1 ? (values[0] ?? "") : values;
    }
    const valid = validateAssetQuery(record);
    if (!valid.ok) return json(400, { error: valid.error });

    const result = await fetchReleaseAsset(valid.request, fetchImpl);
    if (Buffer.isBuffer(result.body)) {
        return new Response(new Uint8Array(result.body), { status: result.status, headers: { ...extraHeaders, ...result.headers } });
    }
    return json(result.status, result.body, result.headers);
}
