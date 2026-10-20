/**
 * Where a plugin install comes from: a GitHub repository URL a user pasted.
 *
 * Pure and network-free on purpose — parsing "which repo, which ref" is the
 * part worth unit-testing, and the installer (apps/web) only calls GitHub once
 * it has a `PluginSource`. Everything here is a string transform; nothing
 * fetches, and nothing trusts the input.
 *
 * Accepted shapes (docs/plugins.md §11):
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/<ref>       (a branch/tag link)
 *   https://github.com/owner/repo/releases/tag/<tag>
 *   owner/repo                                      (the bare shorthand)
 *   git@github.com:owner/repo.git                   (an ssh remote)
 *
 * GitHub-only by design: the release-API path (`/releases/latest`) is what makes
 * "find the manifest asset" reliable, and a self-hosted forge would need a
 * different discovery story. The seam is `PluginSource` — a future host supplies
 * its own resolver and the rest of the installer is unchanged.
 */

/** One resolvable plugin repository: an `owner/repo` on GitHub, plus an optional ref. */
export interface PluginSource {
    owner: string;
    repo: string;
    /**
     * The ref to read the manifest from when there is no release asset: a tag
     * from a `/tree/<ref>` or `/releases/tag/<tag>` link. `null` means "use the
     * latest release".
     */
    ref: string | null;
}

/** GitHub's owner/repo rules: letters, digits, `-`, `_`, `.`; no leading dot. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Parse a pasted URL or shorthand into a {@link PluginSource}, or return `null`
 * when it is not a recognisable GitHub repository reference. Returning `null`
 * (not throwing) lets the install field show "that is not a repository link"
 * while the user types, without a try/catch at the call site.
 */
export function parsePluginSource(input: string): PluginSource | null {
    const text = input.trim();
    if (text.length === 0) return null;

    // Bare `owner/repo` shorthand — one slash, no scheme, no spaces.
    if (!text.includes("://") && !text.startsWith("git@")) {
        const parts = text.split("/");
        if (parts.length === 2) {
            const [owner, repo] = parts as [string, string];
            return validPair(owner, repo, null);
        }
        return null;
    }

    // `git@github.com:owner/repo.git`
    const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(text);
    if (ssh) {
        const [, owner, repo] = ssh as unknown as [string, string, string];
        return validPair(owner, repo, null);
    }

    // Reject traversal BEFORE URL normalization can hide it: `new URL()` turns
    // `https://github.com/owner/../../etc/x` into `/etc/x`, which would then
    // parse as the plausible-but-wrong repo `etc/x`. URL normalizes the path on
    // construction, so the check has to run on the raw pasted string — the
    // portion after the authority, up to any query/fragment.
    const rawPath = text
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .replace(/^[^/]*/, "") // drop the authority
        .split(/[?#]/)[0] ?? "";
    if (/(?:^|\/)\.\.?(?:\/|$)/.test(rawPath)) return null;

    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    const [owner, rawRepo] = segments as [string, string | undefined];
    if (!owner || rawRepo === undefined) return null;
    const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;

    // `/tree/<ref>` and `/releases/tag/<tag>` both carry a ref to read from.
    let ref: string | null = null;
    const treeIndex = segments.indexOf("tree");
    if (treeIndex !== -1 && segments[treeIndex + 1]) {
        // A ref can itself contain slashes (`feat/x`); join the rest.
        ref = segments.slice(treeIndex + 1).join("/");
    }
    const tagIndex = segments.indexOf("tag");
    if (tagIndex !== -1 && segments[tagIndex + 1]) {
        ref = segments.slice(tagIndex + 1).join("/");
    }

    return validPair(owner, repo, ref);
}

function validPair(owner: string, repo: string, ref: string | null): PluginSource | null {
    if (!OWNER.test(owner) || !SEGMENT.test(repo) || repo.endsWith(".git")) return null;
    // `SEGMENT`/`OWNER` already refuse `.` and `..` (they require a leading
    // alphanumeric), but state it here too so a future relaxation cannot
    // quietly readmit traversal.
    if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
    return { owner, repo, ref };
}

/** The canonical browsable URL for a source — what the consent screen links. */
export function sourceUrl(source: PluginSource): string {
    return `https://github.com/${source.owner}/${source.repo}`;
}

/** The repository as `owner/repo`. */
export function sourceSlug(source: PluginSource): string {
    return `${source.owner}/${source.repo}`;
}

/**
 * Where the manifest lives, in resolution order. The installer walks this list
 * and uses the first response that parses as a manifest:
 *
 * 1. the release asset at the pinned tag (`/releases/tags/<ref>` → asset);
 * 2. the release asset at the latest release (`/releases/latest` → asset);
 * 3. the committed file at the ref, raw.
 *
 * Assets are preferred because the release manifest is the one carrying
 * `integrity`; the raw file is the fallback for a repo that has not cut a
 * release yet, and the installer refuses it for want of a hash — honestly,
 * rather than silently downloading an unhashed bundle.
 */
export function releaseApiUrl(source: PluginSource): string {
    return source.ref
        ? `https://api.github.com/repos/${source.owner}/${source.repo}/releases/tags/${encodeURIComponent(source.ref)}`
        : `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`;
}

/** The raw fallback: `tumult.plugin.json` at the ref (or default branch). */
export function rawManifestUrl(source: PluginSource): string {
    const ref = source.ref ?? "HEAD";
    return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/tumult.plugin.json`;
}
