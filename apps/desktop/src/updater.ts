/**
 * The impure half of the desktop updater: one `electron-updater` instance, one
 * snapshot, and the commands the preload forwards from the settings page.
 *
 * Everything that can be decided without Electron lives in `update-state.ts`.
 * This file does three things: configure the updater (a GitHub feed from the
 * packaged `app-update.yml`, or a loopback feed in the smoke test), publish
 * immutable snapshots, and translate failures into UI-safe sentences. The app
 * never downloads or installs anything on its own — the user asks in Settings.
 */
import { autoUpdater } from "electron-updater";
import type { AppUpdater } from "electron-updater";

import type { UpdateSnapshot } from "../../../packages/ui/src/updater/bridge.ts";
import { repairAppImageLaunchers } from "./launcher.ts";
import {
    available,
    canSelfUpdate,
    checking,
    downloaded,
    downloading,
    failed,
    installing,
    unavailable,
    unsupportedSnapshot,
    type UpdaterEnvironment,
} from "./update-state.ts";

export interface UpdaterController {
    readonly snapshot: () => UpdateSnapshot;
    readonly onChange: (callback: (snapshot: UpdateSnapshot) => void) => () => void;
    readonly check: () => Promise<UpdateSnapshot>;
    readonly download: () => Promise<UpdateSnapshot>;
    readonly install: () => void;
}

/** A busy state: a second click must not start a second check or download. */
function busy(snapshot: UpdateSnapshot): boolean {
    return snapshot.phase === "checking" || snapshot.phase === "downloading" || snapshot.phase === "installing";
}

/**
 * Build the main process's updater. Passing the updater in is deliberate: the
 * unit tests use a fake emitter, and there is no reason for a snapshot test to
 * need a packaged app or a network.
 */
export function createUpdater(env: UpdaterEnvironment, updater: AppUpdater = autoUpdater): UpdaterController {
    let current: UpdateSnapshot = canSelfUpdate(env) ? { phase: "idle" } : unsupportedSnapshot(env);
    const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
    let checkInFlight: Promise<UpdateSnapshot> | null = null;
    let downloadInFlight: Promise<UpdateSnapshot> | null = null;

    const publish = (next: UpdateSnapshot): UpdateSnapshot => {
        current = next;
        for (const listener of listeners) listener(next);
        return next;
    };
    // `failed` calls the shared translator, which logs the raw error with the
    // same context, so a sentence on screen never hides the real cause.
    const fail = (error: unknown, context: string, version?: string): UpdateSnapshot =>
        publish(failed(error, context, version));

    if (canSelfUpdate(env)) {
        // Manual by design: a check costs one request, a download is ~120 MB,
        // and neither should happen behind the user's back.
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.autoRunAppAfterInstall = true;

        // The smoke test points the real updater at a loopback feed. Electron
        // refuses a config in dev unless explicitly told this is intentional.
        const feed = env.env.TUMULT_UPDATE_URL?.trim();
        if (feed && !env.packaged) {
            updater.forceDevUpdateConfig = true;
            updater.setFeedURL({ provider: "generic", url: feed });
        }

        updater.on("download-progress", (progress) => {
            if (current.version === undefined || current.phase !== "downloading") return;
            publish(downloading(current.version, progress.percent));
        });
        updater.on("update-downloaded", (event) => {
            publish(downloaded(event.version || current.version || "unknown"));
        });
        updater.on("error", (error) => {
            if (current.phase === "checking" || current.phase === "downloading") {
                fail(error, "Couldn't update Tumult", current.version);
            } else {
                console.error("[tumult] updater", error);
            }
        });
        updater.on("appimage-filename-updated", (newPath) => {
            const oldPath = env.env.APPIMAGE ?? "";
            void repairAppImageLaunchers(oldPath, newPath, env.env)
                .then((files) => {
                    if (files.length > 0) console.info(`[tumult] updated desktop launchers: ${files.join(", ")}`);
                })
                .catch((error: unknown) => console.warn("[tumult] could not update desktop launchers", error));
        });
    }

    return {
        snapshot: () => current,
        onChange(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        check() {
            if (!canSelfUpdate(env) || busy(current)) return Promise.resolve(current);
            if (checkInFlight) return checkInFlight;
            const version = current.version;
            publish(checking());
            checkInFlight = (async () => {
                try {
                    const result = await updater.checkForUpdates();
                    if (!result || !result.isUpdateAvailable) return publish(unavailable());
                    return publish(available(result.updateInfo.version));
                } catch (error) {
                    return fail(error, "Couldn't check for updates", version);
                } finally {
                    checkInFlight = null;
                }
            })();
            return checkInFlight;
        },
        download() {
            if (current.phase !== "available" || current.version === undefined || busy(current)) {
                return Promise.resolve(current);
            }
            if (downloadInFlight) return downloadInFlight;
            const version = current.version;
            publish(downloading(version, 0));
            downloadInFlight = (async () => {
                try {
                    await updater.downloadUpdate();
                    return publish(downloaded(version));
                } catch (error) {
                    return fail(error, "Couldn't download the update", version);
                } finally {
                    downloadInFlight = null;
                }
            })();
            return downloadInFlight;
        },
        install() {
            if (current.phase !== "downloaded" || current.version === undefined) return;
            const version = current.version;
            publish(installing(version));
            try {
                // Not silent: on Linux this replaces the AppImage and relaunches
                // it; on Windows it runs the NSIS installer. The process may
                // exit before this returns, which is why the bridge is a send.
                updater.quitAndInstall(false, true);
            } catch (error) {
                fail(error, "Couldn't install the update", version);
            }
        },
    };
}
