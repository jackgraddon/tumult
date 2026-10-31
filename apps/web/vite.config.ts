import vue from "@vitejs/plugin-vue";
import type { Plugin, Rollup } from "vite";
import { build, defineConfig, loadEnv } from "vite";

/**
 * Absolute path of the monorepo root — TWO levels above this config's directory
 * (`apps/web` → `apps` → the root). Env files are read from THERE, not from
 * `apps/web`.
 *
 * The Vercel build is why: the project's Root Directory is `apps/web`, so
 * `vercel` commands run from the repo root (running them inside `apps/web`
 * would compose into `apps/web/apps/web`, which `vercel deploy` rejects), and
 * `vercel pull` therefore writes `.vercel/.env.production.local` at the repo
 * root. `envDir` is how Vite is told to look in the same place. Without it the
 * production build silently loses `VITE_CLIENT_URI` — the exact failure that
 * served a blank site.
 *
 * `envDir` is NOT restricted to CI: the local `.env.local` lives at the repo
 * root too, so dev and the deployed build read env the same way.
 *
 * Derived from `import.meta.dirname` by string arithmetic rather than
 * `node:path`, because this config deliberately references no Node APIs (it is
 * typechecked under `types: ["vite/client"]`).
 */
const envDir = `${import.meta.dirname}/../..`;

/**
 * The plugin sandbox frame's own policy. It is the page's `<meta>` (so dev and
 * `vite preview`, which sends no headers, enforce it exactly as production
 * does) and, with `frame-ancestors 'self'` added, its header in dev and in
 * `vercel.json` — the browser smoke test pins that header to this string.
 *
 * `'self'` still matches the bootstrap script although the frame's origin is
 * opaque: CSP resolves it against the document's URL (VERIFIED in Firefox and
 * Chromium). The inner Worker is a `blob:` the frame mints, and so is the
 * plugin module it imports, hence `blob:` in both script-src and worker-src.
 */
function sandboxCsp(connectSrc: string): string {
    return [
        "default-src 'none'",
        "script-src 'self' blob:",
        "worker-src blob:",
        connectSrc,
        "img-src blob: data:",
        "style-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");
}

/** The static sandbox page. A real same-server URL, never `srcdoc` (which inherits the APP's policy). */
function sandboxHtml(policy: string): string {
    const escaped = policy.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return `<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="${escaped}" />
        <meta name="referrer" content="no-referrer" />
        <title>Tumult plugin sandbox</title>
    </head>
    <body>
        <script src="sandbox.js"></script>
    </body>
</html>
`;
}

/** The first chunk's code from a `write: false` build. */
function chunkCode(output: Rollup.RollupOutput | Rollup.RollupOutput[] | Rollup.RollupWatcher): string {
    const outputs = Array.isArray(output) ? output : [output];
    for (const one of outputs) {
        if (!("output" in one)) continue;
        for (const item of one.output) if (item.type === "chunk") return item.code;
    }
    throw new Error("the sandbox build produced no chunk");
}

/** Build one entry as a self-contained classic (IIFE) script, in memory. */
async function buildClassic(root: string, entry: string, define: Record<string, string>): Promise<string> {
    const output = await build({
        configFile: false,
        root,
        logLevel: "warn",
        publicDir: false,
        define,
        build: {
            write: false,
            minify: true,
            sourcemap: false,
            lib: { entry, formats: ["iife"], name: "TumultSandbox", fileName: () => "sandbox.js" },
        },
    });
    return chunkCode(output);
}

/**
 * Serve and emit the plugin sandbox: `/sandbox.html` (static page, own CSP) and
 * `/sandbox.js` (classic bootstrap with the inner Worker inlined). Two builds:
 * the Worker first, then the bootstrap with the Worker's code as a string.
 * Classic on purpose — an opaque-origin document fetches module scripts in CORS
 * mode, so a module bootstrap from our own server is refused.
 */
function sandboxFrame(connectSrc: string): Plugin {
    const root = import.meta.dirname;
    const policy = sandboxCsp(connectSrc);
    const script = async (): Promise<string> => {
        const worker = await buildClassic(root, "src/plugins/sandbox.worker.ts", {});
        return buildClassic(root, "src/plugins/sandbox.frame.ts", { __TUMULT_SANDBOX_WORKER__: JSON.stringify(worker) });
    };
    return {
        name: "tumult-sandbox-frame",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = (req.url ?? "").split("?")[0];
                if (path === "/sandbox.html") {
                    res.setHeader("Content-Type", "text/html; charset=utf-8");
                    res.setHeader("Content-Security-Policy", `${policy}; frame-ancestors 'self'`);
                    res.end(sandboxHtml(policy));
                    return;
                }
                if (path === "/sandbox.js") {
                    // Rebuilt per request: dev only, and it keeps edits to the
                    // runtime live without a watcher.
                    script().then(
                        (code) => {
                            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
                            res.setHeader("Cache-Control", "no-store");
                            res.end(code);
                        },
                        (error: unknown) => next(error),
                    );
                    return;
                }
                next();
            });
        },
        async generateBundle() {
            this.emitFile({ type: "asset", fileName: "sandbox.html", source: sandboxHtml(policy) });
            this.emitFile({ type: "asset", fileName: "sandbox.js", source: await script() });
        },
    };
}

export default defineConfig(({ mode }) => {
    // Resolved against `envDir`, so this sees exactly what `import.meta.env`
    // will see in the bundle — the guard below cannot disagree with the build.
    const env = loadEnv(mode, envDir, "");

    // `--mode fake` boots the deterministic fake client instead of the real
    // one. This is an alias, not a runtime branch in src/chat.ts, because a
    // runtime check would still *link* chat.real.ts — and linking it is what
    // drags matrix-js-sdk (and its crypto WASM) into the fake build. The
    // browser smoke test (`pnpm test:browser`) and offline UI work use it.
    //
    // The replacement is resolved against the project root by Vite, so it needs
    // no filesystem path math here (and no Node types in this file).
    const alias = { "@chat-impl": mode === "fake" ? "/src/chat.fake.ts" : "/src/chat.real.ts" };

    // The client URI is REQUIRED by the real client, and a build without it used
    // to produce a bundle that threw at module scope — leaving `#app` empty, so
    // the site served a blank page while every CI gate stayed green (the throw
    // is a runtime error, and the fake build never links it). Failing here
    // instead makes the same mistake a failed BUILD, named at its cause.
    //
    // Only the real client needs it: `--mode fake` deliberately has no client.
    if (mode !== "fake" && !env.VITE_CLIENT_URI) {
        throw new Error(
            "VITE_CLIENT_URI is not set. It must be a public https URL you control " +
                "(MAS rejects http and rejects localhost). See .env.example. In CI/Vercel, " +
                "`vercel pull` writes .vercel/.env.production.local into its working directory " +
                "and Vite reads it via `envDir` (see apps/web/vite.config.ts).",
        );
    }

    // The embedded call app (Element Call) is a cross-origin iframe, so its
    // origin must be named in `frame-src`; without the directive a frame falls
    // back to `default-src 'self'` and is blocked. Unset means calls are off
    // (the client reports `supportsCalls() === false`), so no call origin is
    // allowed at all (only the plugin sandbox's 'self'). Only the ORIGIN is allowed, never the path: the app is addressed
    // by origin, and a path in CSP would silently stop matching on redirect.
    const callOrigin = /^https?:\/\/[^/?#]+/.exec(env.VITE_ELEMENT_CALL_URL ?? "")?.[0];

    // The policy is one constant because dev and the build must not drift: dev
    // sends it as a header, and the build embeds it in index.html (`cspMeta`
    // below), which is what both production and the browser smoke test's
    // `preview` serve. Preview deliberately sends NO header of its own — one
    // would mask a broken meta policy, and the test would pass while production
    // ran with none.
    // A plugin talks to the server its user gave it, which is often plain http
    // on a home network. `ws:` is that rule for a WebSocket: a self-hosted SFU
    // on a LAN (and the RTC test stack) signals over plain ws, and `http:`
    // already permits plaintext. Shared with the plugin sandbox frame, whose
    // connect-src MIRRORS the app's (tightening it is a separate decision).
    const connectSrc = "connect-src 'self' https: http: wss: ws:";

    const csp = [
        "default-src 'self'",
        // The Rust crypto layer is WASM ('wasm-unsafe-eval'), and the
        // trusted-lane plugin loader imports a verified bundle from a
        // blob: URL (blob:).
        "script-src 'self' 'wasm-unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline'",
        // A plugin may load images from a server the user points it at (a
        // self-hosted media server on the LAN is plain http), so the picture
        // directive has to allow http: as well as https:.
        "img-src 'self' data: blob: https: http:",
        // The self-hosted Figtree faces are same-origin; naming the
        // directive keeps a future default-src tightening from
        // silently dropping the UI font.
        "font-src 'self'",
        // Inline <video>/<audio> playback is a blob: URL, which
        // media-src would otherwise inherit from default-src 'self'. A media
        // plugin streams straight from its own server, so the directive names
        // the schemes a LAN server can use.
        "media-src 'self' blob: https: http:",
        // The same reason as media: see `connectSrc` above.
        connectSrc,
        "worker-src 'self' blob:",
        // 'self' is the plugin sandbox frame (`/sandbox.html`). CSP cannot name
        // a bare path, and a full URL would pin one deployment's host, so the
        // origin is the narrowest source that works everywhere; what the frame
        // may do is its own policy (`sandboxCsp`) plus the `sandbox` attribute
        // the installer sets.
        ["frame-src 'self'", callOrigin].filter(Boolean).join(" "),
    ].join("; ");

    // Production has no server of ours to set a header (Vercel serves the static
    // build, and `vercel.json` is static so it cannot see `callOrigin`), so the
    // BUILT document carries the policy itself. It goes straight after
    // `<meta charset>`: before every script, preload and stylesheet (a meta
    // policy only governs what follows it), but not before the charset, which
    // browsers only honour within the first 1024 bytes. No anchor fails the
    // build rather than shipping without a policy. A <meta> policy cannot
    // express `frame-ancestors`; that one lives in `vercel.json`'s headers, and
    // must stay out of `csp` (a meta policy that names it logs a console error).
    const cspMeta: Plugin = {
        name: "tumult-csp-meta",
        apply: "build",
        transformIndexHtml(html) {
            const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(html);
            if (!charset) throw new Error("index.html has no <meta charset> to anchor the CSP <meta> after");
            const escaped = csp.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
            const tag = `\n        <meta http-equiv="Content-Security-Policy" content="${escaped}" />`;
            const end = charset.index + charset[0].length;
            return html.slice(0, end) + tag + html.slice(end);
        },
    };

    return {
        plugins: [vue(), cspMeta, sandboxFrame(connectSrc)],
        // Read env files from the repo root, where `vercel pull` writes them and
        // where the local `.env.local` lives. See `envDir` above.
        envDir,
        resolve: { alias },
        optimizeDeps: {
            // The crypto glue resolves its .wasm relative to itself. Vite's dep
            // optimizer rewrites the glue into .vite/deps/ but does not copy the
            // asset alongside it, so the fetch 404s and the SPA fallback answers
            // with index.html — surfacing as "Incorrect response MIME type.
            // Expected 'application/wasm'". Leaving it unbundled keeps the glue
            // next to its .wasm in node_modules, where the relative path resolves.
            //
            // Dev-server only: the production build resolves the asset correctly.
            exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
            // The SDK is only reached through the lazily imported chat client, so
            // left to discovery the optimizer finds it mid-session, re-bundles,
            // and answers the already-loaded page's old `?v=` hashes with
            // "504 Outdated Optimize Dep" — a failed dynamic import ("Importing
            // a module script failed." in Safari) on the Loading card. Bundling
            // the client's value imports up front means no mid-session pass.
            // Nested (`a > b`) because pnpm does not hoist: these resolve from
            // `@tumult/core`, not from this app. The fake has no SDK at all.
            include:
                mode === "fake"
                    ? []
                    : [
                          "@tumult/core > matrix-js-sdk",
                          "@tumult/core > matrix-js-sdk/lib/@types/event.js",
                          "@tumult/core > matrix-js-sdk/lib/@types/partials.js",
                          "@tumult/core > matrix-js-sdk/lib/@types/read_receipts.js",
                          "@tumult/core > matrix-js-sdk/lib/@types/requests.js",
                          "@tumult/core > matrix-js-sdk/lib/@types/search.js",
                          "@tumult/core > matrix-js-sdk/lib/crypto-api/CryptoEvent.js",
                          "@tumult/core > matrix-js-sdk/lib/crypto-api/recovery-key.js",
                          "@tumult/core > matrix-js-sdk/lib/crypto-api/verification.js",
                          "@tumult/core > matrix-js-sdk/lib/matrixrtc/index.js",
                          "@tumult/core > matrix-js-sdk/lib/sliding-sync.js",
                          "@tumult/core > matrix-widget-api",
                      ],
        },
        server: {
            port: 5173,
            headers: { "Content-Security-Policy": csp },
        },
        // Explicitly empty: `preview.headers` DEFAULTS to `server.headers`, so
        // leaving it out sends the dev header and masks the built meta policy.
        preview: { headers: {} },
    };
});
