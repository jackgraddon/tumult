/**
 * Cut a release. No argument keeps `standard-version`'s conventional-commit
 * bump. A version (`v0.2.0` or `0.2.0`) skips that bump and uses the given
 * number, provided the tag does not already exist and is newer than the
 * latest `v*` tag.
 *
 *   pnpm release
 *   pnpm release v0.2.0
 */
import { spawnSync } from "node:child_process";

const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;

export type TagCheck =
    | { ok: true; version: string; tag: string }
    | { ok: false; reason: string };

export function parseVersion(input: string): string | null {
    const match = VERSION_RE.exec(input.trim());
    return match?.[1] ?? null;
}

export function looksLikeVersion(input: string): boolean {
    return /^v?\d/.test(input.trim());
}

/** Negative if `a` < `b`, 0 if equal, positive if `a` > `b`. */
export function compareSemver(a: string, b: string): number {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        const delta = (left[i] ?? 0) - (right[i] ?? 0);
        if (delta !== 0) return delta;
    }
    return 0;
}

export function versionTags(tags: readonly string[]): string[] {
    return tags
        .map((tag) => tag.trim())
        .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
        .sort((a, b) => compareSemver(b.slice(1), a.slice(1)));
}

export function checkExplicitVersion(input: string, tags: readonly string[]): TagCheck {
    const version = parseVersion(input);
    if (version === null) {
        return {
            ok: false,
            reason: `'${input}' is not a version (expected v0.2.0 or 0.2.0).`,
        };
    }
    const tag = `v${version}`;
    const existing = versionTags(tags);
    if (existing.includes(tag)) {
        return { ok: false, reason: `tag ${tag} already exists.` };
    }
    const latest = existing[0];
    if (latest !== undefined && compareSemver(version, latest.slice(1)) <= 0) {
        return {
            ok: false,
            reason: `${tag} is not newer than the latest tag ${latest}.`,
        };
    }
    return { ok: true, version, tag };
}

function listLocalTags(): string[] {
    const result = spawnSync("git", ["tag", "-l", "v*"], { encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "git tag -l failed");
    }
    return result.stdout.split("\n").filter(Boolean);
}

function runStandardVersion(extra: readonly string[]): never {
    const result = spawnSync("standard-version", ["--no-verify", ...extra], {
        stdio: "inherit",
    });
    process.exit(result.status ?? 1);
}

function main(): void {
    const args = process.argv.slice(2);
    const first = args[0];
    if (first === undefined || !looksLikeVersion(first)) {
        runStandardVersion(args);
    }
    const check = checkExplicitVersion(first, listLocalTags());
    if (!check.ok) {
        console.error(check.reason);
        process.exit(1);
    }
    runStandardVersion(["--release-as", check.version, ...args.slice(1)]);
}

const invoked = process.argv[1]?.replaceAll("\\", "/");
if (invoked?.endsWith("/scripts/release.ts") || invoked?.endsWith("/scripts/release.js")) {
    main();
}
