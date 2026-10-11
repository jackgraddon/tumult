import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
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
        headers: {
            // The Rust crypto layer is WASM, so script-src must allow
            // 'wasm-unsafe-eval' or initRustCrypto() fails at load.
            "Content-Security-Policy": [
                "default-src 'self'",
                "script-src 'self' 'wasm-unsafe-eval'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https:",
                // Inline <video>/<audio> playback is a blob: URL, which
                // media-src would otherwise inherit from default-src 'self'.
                "media-src 'self' blob:",
                "connect-src 'self' https: wss:",
                "worker-src 'self' blob:",
            ].join("; "),
        },
    },
});
