/**
 * Keep a desktop launcher pointed at the AppImage after an update.
 *
 * `AppImageUpdater` replaces the running file. When the old filename contains
 * a version (our release artifacts do), it writes the new version under a NEW
 * name and emits `appimage-filename-updated`. A launcher created by AppImage
 * integration still names the old path, so the next click would run the old
 * binary. This module rewrites the `Exec`/`TryExec` lines of user `.desktop`
 * files that name the old path. It is pure except for the small filesystem
 * walk, so the rewrite itself is unit-testable.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Desktop entries use quoted, escaped paths in `Exec` and `TryExec`. */
export function quoteExecPath(path: string): string {
    return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Repoint `Exec`/`TryExec` lines that name `oldPath`. Other lines — including
 * `Icon`, whose value may happen to contain the same text — are left alone.
 * Returns the new contents, or null when there was nothing to change.
 */
export function repointDesktopLauncher(contents: string, oldPath: string, newPath: string): string | null {
    if (!oldPath || oldPath === newPath) return null;
    const quotedOld = quoteExecPath(oldPath);
    const quotedNew = quoteExecPath(newPath);
    let changed = false;
    const lines = contents.split("\n").map((line) => {
        if (!/^(?:Exec|TryExec)=/.test(line)) return line;
        if (!line.includes(oldPath)) return line;
        changed = true;
        return line.replaceAll(quotedOld, quotedNew).replaceAll(oldPath, quotedNew);
    });
    return changed ? lines.join("\n") : null;
}

function applicationsDir(env: Record<string, string | undefined>): string {
    const root = env.XDG_DATA_HOME?.trim();
    return root ? join(root, "applications") : join(homedir(), ".local", "share", "applications");
}

/**
 * Rewrite every user desktop entry that launches `oldPath`. A missing
 * applications directory (headless Linux, a fresh profile) is normal and is
 * not an error. Returns the filenames that were actually changed.
 */
export async function repairAppImageLaunchers(oldPath: string, newPath: string, env: Record<string, string | undefined> = process.env): Promise<string[]> {
    if (!oldPath || oldPath === newPath) return [];
    let entries: string[];
    try {
        entries = await readdir(applicationsDir(env));
    } catch {
        return [];
    }
    const dir = applicationsDir(env);
    const changed: string[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(".desktop")) continue;
        const file = join(dir, entry);
        try {
            const before = await readFile(file, "utf8");
            const after = repointDesktopLauncher(before, oldPath, newPath);
            if (after === null) continue;
            await writeFile(file, after, "utf8");
            changed.push(entry);
        } catch (error) {
            // One unreadable launcher must not fail an otherwise successful
            // update — report it and carry on with the rest.
            console.warn(`[tumult] could not repair launcher ${entry}`, error);
        }
    }
    return changed;
}
