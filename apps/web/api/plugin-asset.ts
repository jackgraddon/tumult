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

function badRequest(res: VercelResponse, message: string) {
    res.status(400).setHeader("Cache-Control", "no-store").json({ error: message });
}

function tooLarge(res: VercelResponse) {
    res.status(413).setHeader("Cache-Control", "no-store").json({ error: `Asset exceeds ${MAX_ASSET_BYTES} bytes` });
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).setHeader("Cache-Control", "no-store").json({ error: "Method not allowed" });
    }

    const owner = typeof req.query.owner === "string" ? req.query.owner : "";
    const repo = typeof req.query.repo === "string" ? req.query.repo : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag : "";
    const name = typeof req.query.name === "string" ? req.query.name : "";

    if (!OWNER_RE.test(owner)) return badRequest(res, "Invalid owner");
    if (!REPO_RE.test(repo)) return badRequest(res, "Invalid repo");
    if (!TAG_RE.test(tag)) return badRequest(res, "Invalid tag");
    if (!NAME_RE.test(name)) return badRequest(res, "Invalid asset name");

    // GitHub release asset download redirects server-side; CORS does not apply.
    // Construct the URL server-side (no open proxy / SSRF surface).
    const upstream = `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const upstreamRes = await fetch(upstream, {
            method: "GET",
            redirect: "follow",
            headers: {
                // Ask for the raw bytes; release-assets will answer.
                "User-Agent": "tumult-plugin-installer",
                Accept: "application/octet-stream, */*",
            },
            signal: controller.signal,
        });

        if (!upstreamRes.ok) {
            res.setHeader("Cache-Control", "no-store");
            return res.status(upstreamRes.status).json({ error: `Upstream returned ${upstreamRes.status}` });
        }

        // Refuse early when the size is declared, but count anyway: the header
        // can be absent or wrong, and an unbounded read is what we are avoiding.
        const declared = Number(upstreamRes.headers.get("content-length"));
        if (declared > MAX_ASSET_BYTES) {
            controller.abort();
            return tooLarge(res);
        }
        const body = await readCapped(upstreamRes, MAX_ASSET_BYTES);
        if (body === null) {
            controller.abort();
            return tooLarge(res);
        }

        // Headers only once the body is in hand: set earlier, a failed read would
        // send its JSON error under the asset's Content-Type and Content-Length.
        res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/octet-stream");
        res.setHeader("Content-Length", String(body.length));
        // Release assets are immutable per (owner,repo,tag,name).
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).send(body);
    } catch (err) {
        res.setHeader("Cache-Control", "no-store");
        const isAbort = err instanceof Error && err.name === "AbortError";
        return res.status(isAbort ? 504 : 502).json({ error: isAbort ? "Upstream timeout" : "Upstream fetch failed" });
    } finally {
        clearTimeout(timeout);
    }
}
