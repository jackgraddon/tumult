import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

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
    // (the client reports `supportsCalls() === false`), so no origin is allowed
    // at all. Only the ORIGIN is allowed, never the path: the app is addressed
    // by origin, and a path in CSP would silently stop matching on redirect.
    const callOrigin = /^https?:\/\/[^/?#]+/.exec(env.VITE_ELEMENT_CALL_URL ?? "")?.[0];

    // The policy is one constant because dev and preview must not drift: the
    // browser smoke test runs against `preview`, so a header only set on
    // `server` would leave the plugin-blob and crypto-WASM allowances unverified
    // (and the test would pass while a real preview deploy broke).
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
        // The same reason: a plugin talks to the server its user gave it,
        // which is often plain http on a home network.
        "connect-src 'self' https: http: wss:",
        "worker-src 'self' blob:",
        callOrigin ? `frame-src ${callOrigin}` : "frame-src 'none'",
    ].join("; ");

    return {
        plugins: [vue()],
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
        },
        server: {
            port: 5173,
            headers: { "Content-Security-Policy": csp },
        },
        preview: {
            headers: { "Content-Security-Policy": csp },
        },
    };
});
