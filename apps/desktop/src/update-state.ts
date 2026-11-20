/**
 * The pure half of the desktop updater: what state an install can be in, which
 * installs can update themselves, and how an exception becomes a sentence.
 *
 * Electron and `electron-updater` stay out of this module so the state machine
 * is unit-testable without a packaged app or a feed; error sentences come from
 * the same UI-safe translator every other surface uses. `updater.ts` owns the
 * Electron half and publishes these snapshots to the renderer.
 */

import { reportError } from "@tumult/core/errors";

import type { UpdateSnapshot } from "../../../packages/ui/src/updater/bridge.ts";

/** The facts that decide whether this process can replace its own binary. */
export interface UpdaterEnvironment {
    readonly platform: string;
    readonly packaged: boolean;
    readonly env: Record<string, string | undefined>;
}

/**
 * Only an AppImage (Linux) or an NSIS install (Windows) owns its own file. A
 * deb/rpm is owned by the package manager, and a dev build has no installed
 * binary to replace. `TUMULT_UPDATE_URL` is a test-only override that lets the
 * smoke suite drive a real check against a loopback feed.
 */
export function canSelfUpdate({ platform, packaged, env }: UpdaterEnvironment): boolean {
    if (!packaged) return Boolean(env.TUMULT_UPDATE_URL);
    if (platform === "linux") return Boolean(env.APPIMAGE);
    return platform === "win32";
}

/** Why this install cannot update itself, as one sentence for the settings page. */
export function unsupportedMessage({ platform, packaged }: UpdaterEnvironment): string {
    if (!packaged) return "Updates are available in installed builds. This development build has no release feed.";
    if (platform === "linux") {
        return "AppImage installs can update here. deb and rpm installs are upgraded with your package manager.";
    }
    if (platform === "win32") return "This install cannot update itself.";
    return "Updates are not available on this platform.";
}

export function unsupportedSnapshot(env: UpdaterEnvironment): UpdateSnapshot {
    return { phase: "unsupported", message: unsupportedMessage(env) };
}

export function checking(): UpdateSnapshot {
    return { phase: "checking" };
}

export function unavailable(): UpdateSnapshot {
    return { phase: "not-available" };
}

export function available(version: string): UpdateSnapshot {
    return { phase: "available", version };
}

/** Electron reports download progress as a percentage; the bridge uses 0–1. */
export function downloading(version: string, percent = 0): UpdateSnapshot {
    const progress = Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : 0;
    return { phase: "downloading", version, progress };
}

export function downloaded(version: string): UpdateSnapshot {
    return { phase: "downloaded", version };
}

export function installing(version: string): UpdateSnapshot {
    return { phase: "installing", version };
}

/**
 * Translate a main-process failure with the shared error rules: HTTP answers,
 * network failures and our own short sentences are described; an opaque
 * updater code becomes a generic retry sentence. `reportError` logs the raw
 * error with the same context; the sentence alone crosses the bridge.
 */
export function updateError(error: unknown, context: string): string {
    return reportError(error, context) || `${context}. Try again in a moment.`;
}

export function failed(error: unknown, context: string, version?: string): UpdateSnapshot {
    const message = updateError(error, context);
    return version === undefined ? { phase: "error", message } : { phase: "error", message, version };
}
