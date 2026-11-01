/**
 * `app://tumult/<path>` → file + headers, against `apps/web/vercel.json`'s own
 * rules (the desktop must serve what a deployment serves).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { contentTypeFor, headersFor, requestPath, route } from "../src/protocol.ts";

const vercelPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "vercel.json");
const vercel = JSON.parse(readFileSync(vercelPath, "utf8")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
};
const sandboxCsp = vercel.headers.find((rule) => rule.source === "/sandbox.html")?.headers.find((h) => h.key === "Content-Security-Policy")?.value;

const FILES = new Set(["index.html", "sandbox.html", "sandbox.js", "assets/index-abc.js", "assets/crypto.wasm", "fonts/figtree.woff2"]);
const exists = (file: string) => FILES.has(file);

describe("route", () => {
    it("serves an existing file with the app's headers", () => {
        const r = route("app://tumult/assets/index-abc.js", exists);
        assert.equal(r.kind, "file");
        assert.equal(r.kind === "file" && r.file, "assets/index-abc.js");
        assert.equal(r.headers["Content-Security-Policy"], "frame-ancestors 'none'");
        assert.equal(r.headers["X-Content-Type-Options"], "nosniff");
        assert.equal(r.headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    });

    it("answers / and unknown app routes with index.html (the SPA fallback)", () => {
        for (const path of ["/", "/dms", "/g/%21space%3Ahs/%21room%3Ahs", "/auth/callback", "/login"]) {
            const r = route(`app://tumult${path}?x=1#frag`, exists);
            assert.deepEqual(r.kind === "file" && r.file, "index.html", path);
            assert.equal(r.headers["Content-Security-Policy"], "frame-ancestors 'none'", path);
        }
    });

    it("serves /sandbox.html with its OWN policy, not the app's frame-ancestors 'none'", () => {
        const r = route("app://tumult/sandbox.html", exists);
        assert.equal(r.kind === "file" && r.file, "sandbox.html");
        assert.ok(sandboxCsp);
        assert.equal(r.headers["Content-Security-Policy"], sandboxCsp);
        assert.match(sandboxCsp, /frame-ancestors 'self'/);
        assert.equal(r.headers["Referrer-Policy"], "no-referrer");
    });

    it("never falls back to index.html for a missing sandbox page or script", () => {
        const none = () => false;
        assert.equal(route("app://tumult/sandbox.html", (f) => f === "index.html").kind, "not-found");
        assert.equal(route("app://tumult/sandbox.js", (f) => f === "index.html").kind, "not-found");
        assert.equal(route("app://tumult/", none).kind, "not-found");
    });

    it("routes /api/plugin-asset to the proxy and 404s any other /api path", () => {
        const r = route("app://tumult/api/plugin-asset?owner=a&repo=b&tag=v1&name=x.js", exists);
        assert.equal(r.kind, "plugin-asset");
        assert.equal(r.kind === "plugin-asset" && r.query.get("repo"), "b");
        assert.equal(route("app://tumult/api/other", exists).kind, "not-found");
        assert.equal(route("app://tumult/api", exists).kind, "not-found");
    });

    it("refuses other hosts and schemes", () => {
        assert.equal(route("app://evil/index.html", exists).kind, "not-found");
        assert.equal(route("https://tumult/index.html", exists).kind, "not-found");
    });

    it("cannot be walked out of the root", () => {
        assert.equal(requestPath(new URL("app://tumult/../../etc/passwd")), "/etc/passwd");
        assert.equal(requestPath(new URL("app://tumult/assets/%2e%2e/%2e%2e/secret")), "/secret");
        assert.equal(requestPath(new URL("app://tumult/a%5C..%5C..%5Cwin.ini")), null, "a backslash is a separator on Windows");
        assert.equal(requestPath(new URL("app://tumult/a%00b")), null);
        assert.equal(requestPath(new URL("app://tumult/%E0%A4%A")), null, "malformed percent-encoding");
        // Traversal that resolves to a real file is just that file.
        const r = route("app://tumult/x/../sandbox.js", exists);
        assert.equal(r.kind === "file" && r.file, "sandbox.js");
    });
});

describe("headersFor", () => {
    it("matches vercel.json's negative lookahead exactly", () => {
        assert.equal(headersFor("/sandbox.html")["Content-Security-Policy"], sandboxCsp);
        // /sandbox.js is NOT excluded from the app rule (only the page is).
        assert.equal(headersFor("/sandbox.js")["Content-Security-Policy"], "frame-ancestors 'none'");
        assert.equal(headersFor("/sandbox.html.bak")["Content-Security-Policy"], "frame-ancestors 'none'");
    });
});

describe("contentTypeFor", () => {
    it("names the types the app depends on", () => {
        assert.equal(contentTypeFor("assets/crypto.wasm"), "application/wasm");
        assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
        assert.equal(contentTypeFor("sandbox.js"), "text/javascript; charset=utf-8");
        assert.equal(contentTypeFor("fonts/figtree.woff2"), "font/woff2");
        assert.equal(contentTypeFor("favicon.svg"), "image/svg+xml");
        assert.equal(contentTypeFor("THEME.JSON"), "application/json; charset=utf-8");
        assert.equal(contentTypeFor("noext"), "application/octet-stream");
    });
});
