/**
 * How `app://tumult/<path>` maps to the web build — pure, no Electron, so the
 * mapping is unit tested (`test/protocol.test.ts`).
 *
 * The rules are `apps/web/vercel.json`'s, read from that file at build time
 * rather than restated here: the desktop serves exactly what a deployment
 * serves. Vercel's order is filesystem first, then functions (`/api/*`), then
 * `rewrites`; `headers` are matched against the REQUEST path (so the rewritten
 * `index.html` carries the headers of the URL that asked for it).
 */
import vercel from "../../web/vercel.json" with { type: "json" };

import { DESKTOP_ORIGIN } from "../../web/src/desktop.ts";

export const APP_SCHEME = "app";
export const APP_HOST = new URL(DESKTOP_ORIGIN).host;
export { DESKTOP_ORIGIN as APP_ORIGIN };

interface HeaderRule {
    source: string;
    headers: { key: string; value: string }[];
}

interface RewriteRule {
    source: string;
    destination: string;
}

/**
 * Vercel `source` patterns in this repo are regular expressions in
 * path-to-regexp's group syntax (`/((?!sandbox\\.html$).*)`), i.e. a whole-path
 * regex. Anchored, they mean the same thing to JavaScript's RegExp.
 */
function pattern(source: string): RegExp {
    return new RegExp(`^${source}$`);
}

const HEADER_RULES = (vercel.headers as HeaderRule[]).map((rule) => ({ test: pattern(rule.source), headers: rule.headers }));
const REWRITE_RULES = (vercel.rewrites as RewriteRule[]).map((rule) => ({ test: pattern(rule.source), destination: rule.destination }));

/** Every `vercel.json` header whose source matches `path`, later rules winning. */
export function headersFor(path: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rule of HEADER_RULES) {
        if (!rule.test.test(path)) continue;
        for (const { key, value } of rule.headers) out[key] = value;
    }
    return out;
}

/** The one function the web app has (`apps/web/api/plugin-asset.ts`). */
export const PLUGIN_ASSET_PATH = "/api/plugin-asset";

export type Route =
    /** Serve this file, relative to the web root, with these headers. */
    | { kind: "file"; file: string; headers: Record<string, string> }
    /** Answer through the plugin-asset proxy. */
    | { kind: "plugin-asset"; query: URLSearchParams; headers: Record<string, string> }
    | { kind: "not-found"; headers: Record<string, string> };

/**
 * The request path, decoded and normalised, or null when it is not a path we
 * will ever map to a file: a NUL, a backslash (a separator on Windows, so
 * `%5C..%5C` would otherwise climb out of the root), or bad percent-encoding.
 * `..` segments are already resolved by the URL parser; the main process
 * re-checks containment against the real root anyway.
 */
export function requestPath(url: URL): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(url.pathname);
    } catch {
        return null;
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    const parts: string[] = [];
    for (const part of decoded.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return `/${parts.join("/")}`;
}

/**
 * Route one `app://` request. `exists(file)` says whether a regular file exists
 * at that root-relative path (`index.html`, `assets/x.js`).
 */
export function route(rawUrl: string, exists: (file: string) => boolean): Route {
    const url = new URL(rawUrl);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return { kind: "not-found", headers: {} };

    const path = requestPath(url);
    if (path === null) return { kind: "not-found", headers: {} };
    const headers = headersFor(path);

    // 1. The filesystem. `/` is the directory, never a file of its own.
    const file = path.slice(1);
    if (file !== "" && exists(file)) return { kind: "file", file, headers };

    // 2. Functions. Only the one the web app has; any other /api path is a 404
    //    rather than index.html, so a fetch never parses the app shell as data.
    if (path === PLUGIN_ASSET_PATH) return { kind: "plugin-asset", query: url.searchParams, headers };
    if (path === "/api" || path.startsWith("/api/")) return { kind: "not-found", headers };

    // 3. Rewrites: the SPA fallback, which excludes /sandbox.html and
    //    /sandbox.js by its own negative lookahead.
    for (const rule of REWRITE_RULES) {
        if (!rule.test.test(path)) continue;
        const target = rule.destination.replace(/^\//, "");
        if (exists(target)) return { kind: "file", file: target, headers };
    }
    return { kind: "not-found", headers };
}

const CONTENT_TYPES: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    map: "application/json; charset=utf-8",
    // WebAssembly.instantiateStreaming refuses anything else (the crypto WASM).
    wasm: "application/wasm",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    txt: "text/plain; charset=utf-8",
    webmanifest: "application/manifest+json",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
};

/** The Content-Type for a file name; unknown types are opaque bytes (and `nosniff` keeps them so). */
export function contentTypeFor(file: string): string {
    const dot = file.lastIndexOf(".");
    const extension = dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
    return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
