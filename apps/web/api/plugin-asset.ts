/**
 * The slice of Vercel's Node request/response helpers this function uses.
 * Declared here rather than imported from `@vercel/node`: we only ever needed
 * its types (Vercel's runtime supplies the objects), and the package pins
 * releases of undici, path-to-regexp and others with open advisories — even in
 * its latest version — into every install.
 */
interface VercelRequest {
    method?: string;
    query: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
    status(code: number): VercelResponse;
    setHeader(name: string, value: string): VercelResponse;
    json(body: unknown): VercelResponse;
    send(body: unknown): VercelResponse;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const NAME_RE = /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/;

/**
 * Largest asset this proxy will relay. A plugin bundle is a JS module plus its
 * manifest, far below this; the ceiling exists so one request cannot make the
 * function buffer an arbitrary release asset. It sits under Vercel's 4.5 MB
 * function response limit, which would otherwise fail the request less clearly.
 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/** The whole body, or null once it passes `limit` bytes (reading stops there). */
export async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks, total);
}

/** A validated request for one release asset. */
export interface AssetRequest {
    owner: string;
    repo: string;
    tag: string;
    name: string;
}

/**
 * Validate the four query parameters. Pure, and shared with the desktop shell's
 * protocol handler (`apps/desktop/src/plugin-asset.ts`), which answers the same
 * `/api/plugin-asset` URL from the Electron main process — one rule for both.
 */
export function validateAssetQuery(
    query: Record<string, string | string[] | undefined>,
): { ok: true; request: AssetRequest } | { ok: false; error: string } {
    const owner = typeof query.owner === "string" ? query.owner : "";
    const repo = typeof query.repo === "string" ? query.repo : "";
    const tag = typeof query.tag === "string" ? query.tag : "";
    const name = typeof query.name === "string" ? query.name : "";

    if (!OWNER_RE.test(owner)) return { ok: false, error: "Invalid owner" };
    if (!REPO_RE.test(repo)) return { ok: false, error: "Invalid repo" };
    if (!TAG_RE.test(tag)) return { ok: false, error: "Invalid tag" };
    if (!NAME_RE.test(name)) return { ok: false, error: "Invalid asset name" };
    return { ok: true, request: { owner, repo, tag, name } };
}

/**
 * The only URL this proxy ever fetches, constructed server-side from the four
 * validated segments — no open proxy / SSRF surface.
 */
export function upstreamUrl(request: AssetRequest): string {
    return `https://github.com/${request.owner}/${request.repo}/releases/download/${request.tag}/${request.name}`;
}

/** What to answer: a status, headers, and either the asset's bytes or a JSON error. */
export interface AssetResult {
    status: number;
    headers: Record<string, string>;
    body: Buffer | { error: string };
}

function failure(status: number, error: string): AssetResult {
    return { status, headers: { "Cache-Control": "no-store" }, body: { error } };
}

/** The `fetch` shape the proxy needs; the desktop passes Electron's `net.fetch`. */
export type AssetFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Fetch one release asset (GitHub's download redirects server-side, where CORS
 * does not apply), under the size ceiling and a 15 s timeout.
 */
export async function fetchReleaseAsset(
    request: AssetRequest,
    fetchImpl: AssetFetch = (input, init) => fetch(input, init),
): Promise<AssetResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const upstreamRes = await fetchImpl(upstreamUrl(request), {
            method: "GET",
            redirect: "follow",
            headers: {
                // Ask for the raw bytes; release-assets will answer.
                "User-Agent": "tumult-plugin-installer",
                Accept: "application/octet-stream, */*",
            },
            signal: controller.signal,
        });

        if (!upstreamRes.ok) return failure(upstreamRes.status, `Upstream returned ${upstreamRes.status}`);

        // Refuse early when the size is declared, but count anyway: the header
        // can be absent or wrong, and an unbounded read is what we are avoiding.
        const declared = Number(upstreamRes.headers.get("content-length"));
        if (declared > MAX_ASSET_BYTES) {
            controller.abort();
            return failure(413, `Asset exceeds ${MAX_ASSET_BYTES} bytes`);
        }
        const body = await readCapped(upstreamRes, MAX_ASSET_BYTES);
        if (body === null) {
            controller.abort();
            return failure(413, `Asset exceeds ${MAX_ASSET_BYTES} bytes`);
        }

        // Headers only once the body is in hand: set earlier, a failed read would
        // send its JSON error under the asset's Content-Type and Content-Length.
        return {
            status: 200,
            headers: {
                "Content-Type": upstreamRes.headers.get("content-type") ?? "application/octet-stream",
                "Content-Length": String(body.length),
                // Release assets are immutable per (owner,repo,tag,name).
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            },
            body,
        };
    } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        return failure(isAbort ? 504 : 502, isAbort ? "Upstream timeout" : "Upstream fetch failed");
    } finally {
        clearTimeout(timeout);
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).setHeader("Cache-Control", "no-store").json({ error: "Method not allowed" });
    }

    const valid = validateAssetQuery(req.query);
    if (!valid.ok) return res.status(400).setHeader("Cache-Control", "no-store").json({ error: valid.error });

    const result = await fetchReleaseAsset(valid.request);
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    res.status(result.status);
    return Buffer.isBuffer(result.body) ? res.send(result.body) : res.json(result.body);
}
