import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
    // `--mode fake` boots the deterministic fake client instead of the real
    // one. This is an alias, not a runtime branch in src/chat.ts, because a
    // runtime check would still *link* chat.real.ts — and linking it is what
    // drags matrix-js-sdk (and its crypto WASM) into the fake build. The
    // browser smoke test (`pnpm test:browser`) and offline UI work use it.
    //
    // The replacement is resolved against the project root by Vite, so it needs
    // no filesystem path math here (and no Node types in this file).
    const alias = { "@chat-impl": mode === "fake" ? "/src/chat.fake.ts" : "/src/chat.real.ts" };

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
        "img-src 'self' data: blob: https:",
        // The self-hosted Figtree faces are same-origin; naming the
        // directive keeps a future default-src tightening from
        // silently dropping the UI font.
        "font-src 'self'",
        // Inline <video>/<audio> playback is a blob: URL, which
        // media-src would otherwise inherit from default-src 'self'.
        "media-src 'self' blob:",
        "connect-src 'self' https: wss:",
        "worker-src 'self' blob:",
    ].join("; ");

    return {
        plugins: [vue()],
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
