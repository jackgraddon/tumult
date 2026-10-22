import type { VercelRequest, VercelResponse } from "@vercel/node";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const NAME_RE = /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/;

function badRequest(res: VercelResponse, message: string) {
    res.status(400).setHeader("Cache-Control", "no-store").json({ error: message });
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

        const contentType = upstreamRes.headers.get("content-type") ?? "application/octet-stream";
        const contentLength = upstreamRes.headers.get("content-length");

        res.setHeader("Content-Type", contentType);
        if (contentLength) res.setHeader("Content-Length", contentLength);
        // Release assets are immutable per (owner,repo,tag,name).
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");

        const arrayBuffer = await upstreamRes.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));
    } catch (err) {
        res.setHeader("Cache-Control", "no-store");
        const isAbort = err instanceof Error && err.name === "AbortError";
        return res.status(isAbort ? 504 : 502).json({ error: isAbort ? "Upstream timeout" : "Upstream fetch failed" });
    } finally {
        clearTimeout(timeout);
    }
}
