/**
 * Cut a release. No argument keeps `standard-version`'s conventional-commit
 * bump. A version (`v0.2.0` or `0.2.0`) skips that bump and uses the given
 * number, provided the tag does not already exist and is newer than the
 * latest `v*` tag.
 *
 * A full run then takes the release to GitHub: the release commit + tag are
 * pushed to `origin`, and a DRAFT release is cut for the tag with the
 * version's CHANGELOG section as its notes. A maintainer flips it live once
 * the desktop CI (.github/workflows/desktop.yml, triggered by the tag push)
 * has attached the Linux/Windows packages — which it uploads RAW as release
 * assets, not as zipped workflow artifacts.
 *
 *   pnpm release              # conventional bump, push + draft release
 *   pnpm release v0.2.0       # cut that exact version
 *   pnpm release --dry-run    # standard-version only; nothing is pushed or published
 *
 * `--dry-run` is honoured end to end: standard-version writes nothing, so there
 * is no new tag to push and no release to cut.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;

// The repo root, resolved from this file's location rather than the cwd so
// `pnpm release` works regardless of where it is run from.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    const result = spawnSync("git", ["tag", "-l", "v*"], { encoding: "utf8", cwd: repoRoot });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "git tag -l failed");
    }
    return result.stdout.split("\n").filter(Boolean);
}

/** True when a version string carries a prerelease suffix, e.g. `1.0.0-rc.1`. */
export function isPrereleaseVersion(version: string): boolean {
    return /-/.test(version);
}

/**
 * The CHANGELOG section for one version: the lines after the header that names
 * it (`## [0.4.1]` or `### [0.4.1]`) up to, but excluding, the next version
 * header. The header itself (which carries only the compare link and the date)
 * is dropped — the body is what belongs in the release notes. Other `### ...`
 * subsections like "Features" / "Bug Fixes" have no `[version]` in them, so
 * they are kept with their entries. Returns "" when the changelog is absent or
 * has no such section, so a release is still cut with empty notes instead of
 * throwing.
 */
export function changelogNotes(changelog: string, version: string): string {
    if (changelog.trim() === "") return "";
    const lines = changelog.split("\n");
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headerFor = new RegExp(`^#{1,3}\\s+\\[${escaped}\\]`);
    const nextHeader = /^#{1,3}\s+\[/;
    const start = lines.findIndex((line) => headerFor.test(line));
    if (start === -1) return "";
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (nextHeader.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join("\n").trim();
}

/** The bumped version: `standard-version` writes it to the repo's package.json. */
function repoVersion(): string {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    return String(pkg.version ?? "");
}

function readChangelog(): string {
    try {
        return readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
    } catch {
        return "";
    }
}

function runStandardVersion(extra: readonly string[]): number {
    const result = spawnSync("standard-version", ["--no-verify", ...extra], { stdio: "inherit" });
    return result.status ?? 1;
}

/** Push the just-cut release commit and annotated tag to `origin`. */
function pushReleaseTag(): void {
    // `--follow-tags` pushes the annotated tag `standard-version` created for the
    // release commit; the suggested command the tool itself prints.
    const result = spawnSync("git", ["push", "--follow-tags", "origin", "HEAD"], {
        stdio: "inherit",
        cwd: repoRoot,
    });
    process.exit(result.status ?? 1);
}

/** Whether a GitHub release already exists for `tag` (so we do not clobber one). */
function releaseExists(tag: string): boolean {
    const result = spawnSync("gh", ["release", "view", tag, "--json", "tagName"], {
        encoding: "utf8",
        cwd: repoRoot,
    });
    return result.status === 0;
}

/**
 * Cut a DRAFT GitHub release for `tag`, with the version's CHANGELOG section as
 * its notes. Draft (not live) so a person reviews the packages the desktop CI
 * attaches before it goes public; `--prerelease` keeps a pre-release out of
 * "latest". The release is not clobbered: a re-run or a competing CI run that
 * already cut it is left with its notes and assets.
 */
function cutRelease(tag: string): void {
    if (releaseExists(tag)) {
        console.log(`release ${tag} already exists; leaving its notes and assets as-is`);
        return;
    }
    const version = tag.slice(1);
    const args = ["release", "create", tag, "--draft", "--title", tag];
    if (isPrereleaseVersion(version)) args.push("--prerelease");
    args.push("--notes", changelogNotes(readChangelog(), version));
    const result = spawnSync("gh", args, { stdio: "inherit", cwd: repoRoot });
    process.exit(result.status ?? 1);
}

function main(): void {
    const args = process.argv.slice(2);
    const first = args[0];
    // `--dry-run` hands standard-version the preview flag and tells us not to
    // push or publish — the tag it would cut is never written.
    const dryRun = args.includes("--dry-run");
    let extra: string[];
    if (first === undefined || !looksLikeVersion(first)) {
        extra = args;
    } else {
        const check = checkExplicitVersion(first, listLocalTags());
        if (!check.ok) {
            console.error(check.reason);
            process.exit(1);
        }
        extra = ["--release-as", check.version, ...args.slice(1)];
    }
    const status = runStandardVersion(extra);
    if (status !== 0) {
        process.exit(status);
    }
    if (dryRun) return;

    // standard-version cut the tag locally; take it to GitHub. `listLocalTags`
    // re-reads now, after the tag exists, so a skipped tag lifecycle means there
    // is nothing new to push or publish.
    const tag = `v${repoVersion()}`;
    if (!listLocalTags().includes(tag)) return;
    pushReleaseTag();
    cutRelease(tag);
}

const invoked = process.argv[1]?.replaceAll("\\", "/");
if (invoked?.endsWith("/scripts/release.ts") || invoked?.endsWith("/scripts/release.js")) {
    main();
}
