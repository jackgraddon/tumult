/**
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * On macOS, Tauri uses WKWebView as its renderer. WKWebView inherits a
 * WebKit "feature": any CryptoKey created with `extractable: false` is
 * automatically persisted to the macOS login Keychain under the account
 * `com.apple.WebKit.WebCrypto.master+<bundle-id>`.
 *
 * This causes two concrete problems:
 *   1. The OS shows an authentication dialog on first access and sometimes
 *      on subsequent launches ("… wants to use your confidential information
 *      stored in … in your keychain").
 *   2. The keychain entry sticks around after logout / reinstall and can
 *      cause stale-key errors on the next fresh session.
 *
 * The root cause is matrix-js-sdk's Rust crypto backend, which calls
 * crypto.subtle.importKey / deriveKey with extractable=false internally.
 * We cannot patch the Rust WASM binary itself, but we can patch the Web
 * Crypto API it calls before the module is ever imported.
 *
 * ─── THE FIX ────────────────────────────────────────────────────────────────
 *
 * We monkey-patch `crypto.subtle.importKey` and `crypto.subtle.deriveKey`
 * to silently flip `extractable` to `true` for key types that WebKit would
 * otherwise persist to the Keychain (AES-*, HMAC, Ed25519, etc.).
 *
 * The two KDF algorithms that WebKit hard-requires to stay non-extractable
 * (HKDF and PBKDF2) are deliberately left alone — passing extractable=true
 * to them throws a DOMException so we must not touch them.
 *
 * Security note: forcing extractability means these keys _could_ be exported
 * by JavaScript running in the same origin. For a Tauri app, the renderer
 * origin is effectively the app bundle and there is no third-party JS, so
 * this is an acceptable trade-off to avoid Keychain entanglement. The keys
 * still only live in memory; we are not writing them anywhere ourselves.
 *
 * This patch mirrors what voice.ts already does for the LiveKit E2EE worker,
 * extended to cover the main thread where matrix-js-sdk runs.
 *
 * ─── PLACEMENT ──────────────────────────────────────────────────────────────
 *
 * Drop this file in your Nuxt `plugins/` directory. The `.client.ts` suffix
 * ensures it only runs in the browser (never during SSR). Nuxt loads plugins
 * in filename order, so prefix it with `01.` if you want to be explicit:
 *
 *   plugins/01.webcrypto-patch.client.ts
 *
 * It must execute before any `import 'matrix-js-sdk'` resolves — Nuxt's
 * plugin system guarantees this because plugins run before the app mounts.
 */

export default defineNuxtPlugin(() => {
    // Only apply inside Tauri (WKWebView on macOS / Linux WebKitGTK).
    // Regular browsers do not persist WebCrypto keys to a keychain.
    if (!(window as any).__TAURI_INTERNALS__) return;

    // Key-derivation functions that WebKit hard-prohibits from being
    // extractable. Attempting to importKey these with extractable=true throws,
    // so we must leave them alone.
    const NON_EXTRACTABLE_ALGOS = new Set(['HKDF', 'PBKDF2']);

    const algoName = (algo: AlgorithmIdentifier): string => {
        if (typeof algo === 'string') return algo.toUpperCase();
        return ((algo as Algorithm).name ?? '').toUpperCase();
    };

    // ── Patch importKey ───────────────────────────────────────────────────────
    const _originalImportKey = crypto.subtle.importKey.bind(crypto.subtle);

    // @ts-expect-error — overwriting a read-only method on the native object
    crypto.subtle.importKey = function patchedImportKey(
        format: Parameters<SubtleCrypto['importKey']>[0],
        keyData: Parameters<SubtleCrypto['importKey']>[1],
        algorithm: Parameters<SubtleCrypto['importKey']>[2],
        extractable: boolean,
        keyUsages: Parameters<SubtleCrypto['importKey']>[4],
    ): ReturnType<SubtleCrypto['importKey']> {
        const name = algoName(algorithm as AlgorithmIdentifier);
        const safeExtractable = NON_EXTRACTABLE_ALGOS.has(name) ? extractable : true;
        return _originalImportKey(format, keyData, algorithm, safeExtractable, keyUsages);
    };

    // ── Patch deriveKey ───────────────────────────────────────────────────────
    // deriveKey produces the *output* key (e.g. AES-GCM) from an HKDF/PBKDF2
    // base key. The *output* key is what WebKit would persist, so we force it
    // extractable. The base key algorithm is irrelevant here.
    const _originalDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);

    crypto.subtle.deriveKey = function patchedDeriveKey(
        algorithm: Parameters<SubtleCrypto['deriveKey']>[0],
        baseKey: CryptoKey,
        derivedKeyType: Parameters<SubtleCrypto['deriveKey']>[2],
        extractable: boolean,
        keyUsages: Parameters<SubtleCrypto['deriveKey']>[4],
    ): ReturnType<SubtleCrypto['deriveKey']> {
        // Always force the derived key extractable — this is the key that
        // WebKit would otherwise write to the Keychain.
        return _originalDeriveKey(algorithm, baseKey, derivedKeyType, true, keyUsages);
    };

    // ── Patch generateKey ─────────────────────────────────────────────────────
    // generateKey is less commonly the culprit but can also produce
    // non-extractable keys that WebKit persists (e.g. Ed25519 signing keys
    // generated by the Rust crypto module for cross-signing).
    const _originalGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);

    // @ts-expect-error
    crypto.subtle.generateKey = function patchedGenerateKey(
        algorithm: Parameters<SubtleCrypto['generateKey']>[0],
        extractable: boolean,
        keyUsages: Parameters<SubtleCrypto['generateKey']>[2],
    ): ReturnType<SubtleCrypto['generateKey']> {
        const name = algoName(algorithm as AlgorithmIdentifier);
        const safeExtractable = NON_EXTRACTABLE_ALGOS.has(name) ? extractable : true;
        return _originalGenerateKey(algorithm, safeExtractable, keyUsages);
    };

    console.log('[webcrypto-patch] crypto.subtle patched — WebKit Keychain persistence disabled');
});