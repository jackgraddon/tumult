/**
 * Third-party plugin installation — fetch a release, verify it, load it.
 *
 * The pure decisions live in `@tumult/ui` (`parsePluginSource`,
 * `checkReleaseManifest`, `hashBundle`, `needsConsent`); this module is the
 * part that must touch the network and the DOM, so it stays in the app:
 *
 *   - resolve a repository URL to a release manifest (GitHub API, with a raw
 *     fallback for a repo that has not cut a release);
 *   - download the bundle and verify its sha256;
 *   - import it from a blob URL and cross-check the bundle's export against the
 *     manifest the user consented to;
 *   - hand the resulting `Plugin` to the shell's registry.
 *
 * Nothing is persisted until the plugin installs cleanly, so a throw anywhere
 * in the chain leaves no residue (mirroring `PluginRegistry.install`'s own
 * rollback). The caller drives the consent screen between `prepare()` and
 * `commit()` — this module never installs without being told to.
 */

import {
    checkReleaseManifest,
    deriveLane,
    hashBundle,
    hashMismatchReason,
    rawManifestUrl,
    releaseApiUrl,
    sandboxPlugin,
    type Plugin,
    type PluginLane,
    type PluginManifest,
    type PluginSource,
    type SandboxHost,
    type SandboxWorker,
} from "@tumult/ui";

/** A release resolved and verified, sitting on the consent screen. */
export interface PreparedInstall {
    source: PluginSource;
    /** `owner/repo`. */
    slug: string;
    /** Browsable repository URL, for the consent screen's source link. */
    url: string;
    /** The release tag, or `""` when read from the raw file. */
    tag: string;
    manifest: PluginManifest;
    lane: PluginLane;
    /** The downloaded, hash-verified bundle text. */
    bundle: string;
    /** Same as `manifest.integrity` — kept explicit for the record. */
    integrity: string;
}

/** How a prepare attempt failed, with copy the dialog can show as-is. */
export class InstallError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "InstallError";
    }
}

async function fetchJson(url: string): Promise<unknown | null> {
    const response = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchAsset(url: string): Promise<Response> {
    // GitHub's release asset API URLs require an Accept header to return the
    // actual binary (not a JSON redirect). Browser fetches to
    // browser_download_url are CORS-blocked from custom origins; using the API
    // asset URL with the octet-stream accept returns the asset with CORS
    // headers.
    return fetch(url, { headers: { accept: "application/octet-stream" } });
}

/** Find the release manifest asset API URL on a release payload, if any. */
function manifestAssetUrl(release: unknown): string | null {
    if (typeof release !== "object" || release === null) return null;
    const assets = (release as { assets?: unknown }).assets;
    if (!Array.isArray(assets)) return null;
    for (const asset of assets) {
        if (typeof asset !== "object" || asset === null) continue;
        const { name, url } = asset as Record<string, unknown>;
        if (name === "tumult.plugin.json" && typeof url === "string") return url;
    }
    return null;
}

/** The release tag from a release payload, or `""`. */
function releaseTag(release: unknown): string {
    if (typeof release !== "object" || release === null) return "";
    const tag = (release as { tag_name?: unknown }).tag_name;
    return typeof tag === "string" ? tag : "";
}

/** The bundle asset API URL on a release whose manifest names `entry`. */
function entryAssetUrl(release: unknown, entry: string): string | null {
    if (typeof release !== "object" || release === null) return null;
    const assets = (release as { assets?: unknown }).assets;
    if (!Array.isArray(assets)) return null;
    for (const asset of assets) {
        if (typeof asset !== "object" || asset === null) continue;
        const { name, url } = asset as Record<string, unknown>;
        if (name === entry && typeof url === "string") return url;
    }
    return null;
}

/** The raw URL for one file at a ref (release-tag or default branch). */
function rawFileUrl(source: PluginSource, ref: string, file: string): string {
    const path = ref === "" ? "HEAD" : ref;
    return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${path}/${file}`;
}

interface ResolvedRelease {
    release: unknown;
    manifest: PluginManifest;
    lane: PluginLane;
    tag: string;
    manifestUrl: string;
}

/**
 * Resolve the release manifest for a source: the release asset (preferred,
 * because that is the document carrying `integrity`), else the raw committed
 * file — which the installer will then reject for want of a hash, honestly.
 */
async function resolveManifest(source: PluginSource): Promise<ResolvedRelease> {
    const release = await fetchJson(releaseApiUrl(source));
    if (release !== null) {
        const assetUrl = manifestAssetUrl(release);
        if (assetUrl) {
            const response = await fetchAsset(assetUrl);
            if (!response.ok) throw new InstallError("Could not download tumult.plugin.json from the release.");
            let document: unknown;
            try {
                document = await response.json();
            } catch {
                throw new InstallError("The release's tumult.plugin.json could not be read.");
            }
            const check = checkReleaseManifest(document);
            if (!check.ok) throw new InstallError(check.reason);
            return {
                release,
                manifest: check.manifest,
                lane: check.lane,
                tag: releaseTag(release),
                manifestUrl: assetUrl,
            };
        }
    }

    // No release (or no manifest asset): read the committed file. It will lack
    // `integrity`, and `checkReleaseManifest` will say so — which is the honest
    // outcome, not a silent unhashed install.
    const fallbackUrl = rawManifestUrl(source);
    const response = await fetch(fallbackUrl);
    if (!response.ok) {
        throw new InstallError(
            `Could not find a release manifest for ${source.owner}/${source.repo}. Make sure ` +
                `the repository has published a release with a tumult.plugin.json asset, or ` +
                `committed a tumult.plugin.json at the repository root.`,
        );
    }
    let document: unknown;
    try {
        document = await response.json();
    } catch {
        throw new InstallError(`${source.owner}/${source.repo} has no readable tumult.plugin.json.`);
    }
    const check = checkReleaseManifest(document);
    if (!check.ok) throw new InstallError(check.reason);
    return {
        release: null,
        manifest: check.manifest,
        lane: check.lane,
        tag: source.ref ?? "",
        manifestUrl: fallbackUrl,
    };
}

/** Download the entry bundle for a resolved release and verify its hash. */
async function downloadBundle(resolved: ResolvedRelease, source: PluginSource): Promise<string> {
    const entry = resolved.manifest.entry;
    if (!entry) throw new InstallError(`The manifest does not name an entry bundle.`);
    const integrity = resolved.manifest.integrity;
    if (!integrity) throw new InstallError(`The manifest has no integrity hash; refusing to install.`);

    const assetUrl = entryAssetUrl(resolved.release, entry);
    const url = assetUrl ?? rawFileUrl(source, resolved.tag, entry);

    let response: Response;
    try {
        response = entryAssetUrl(resolved.release, entry) ? await fetchAsset(url) : await fetch(url);
    } catch {
        throw new InstallError(`Could not download ${entry} from ${source.owner}/${source.repo}.`);
    }
    if (!response.ok) {
        throw new InstallError(`Could not download ${entry} (HTTP ${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = await hashBundle(bytes);
    if (actual !== integrity) throw new InstallError(hashMismatchReason(integrity, actual));

    return new TextDecoder().decode(bytes);
}

/**
 * Resolve, download and verify a plugin without installing it. The caller shows
 * `manifest`/`lane` for consent; `commit()` does the loading and registration.
 */
export async function prepareInstall(source: PluginSource): Promise<PreparedInstall> {
    const resolved = await resolveManifest(source);
    const bundle = await downloadBundle(resolved, source);
    return {
        source,
        slug: `${source.owner}/${source.repo}`,
        url: `https://github.com/${source.owner}/${source.repo}`,
        tag: resolved.tag,
        manifest: resolved.manifest,
        lane: resolved.lane,
        bundle,
        integrity: resolved.manifest.integrity ?? "",
    };
}

/** How `loadPlugin` cross-checks the bundle against the consented manifest. */
export interface CommitOptions {
    /** Fails when the bundle's exported `manifest.id` is not this. */
    expectedId: string;
    /**
     * The lane the installer derived from the consented manifest. `sandbox`
     * loads the bundle in a Worker; `trusted` imports it in-page. Passing this
     * explicitly (rather than re-deriving here) keeps the "who decides where it
     * runs" answer in one place — `deriveLane`, at consent time.
     */
    lane: PluginLane;
    /** How to open the sandbox Worker (the app's only DOM coupling). */
    sandboxHost: SandboxHost;
}

/** What `loadPlugin` needs from an install — both a fresh prepare and a boot reload provide this. */
export interface LoadableBundle {
    manifest: PluginManifest;
    bundle: string;
}

/**
 * Open a module Worker for one plugin. The URL is a local module path so Vite
 * emits it as its own chunk; the shim inside `@tumult/ui` does the rest. A
 * `blob:` worker is deliberately NOT used — `worker-src 'self' blob:` would allow
 * it, but a stable same-origin script URL is easier to audit in devtools.
 */
export function createSandboxWorker(): SandboxWorker {
    return new Worker(new URL("./sandbox.worker.ts", import.meta.url), {
        type: "module",
        name: "tumult-plugin-sandbox",
    }) as unknown as SandboxWorker;
}

/** The app's default host: real Workers, no failure sink (the caller attaches one). */
export const sandboxHost: SandboxHost = { createWorker: createSandboxWorker };

/**
 * Load a verified bundle as a `Plugin`, routed by lane.
 *
 * A `trusted`-lane bundle is imported in-page from a blob URL and cross-checked
 * against the manifest; a `sandbox`-lane one never enters this realm — it is
 * handed to `sandboxPlugin`, which runs it in a Worker and bridges the context.
 *
 * The cross-check is the point of the trusted path: the bundle's exported
 * `manifest.id`/`permissions` must agree with what the user consented to. A
 * bundle whose code says something different from the consent screen is refused
 * — consent is for the manifest, so the manifest has to be the truth. (The
 * sandbox path does not need it: the Worker re-imports the same text, and the
 * host never trusts the Worker's own manifest — the CONSENTED one is what the
 * registry registers and the bridge authorises against.)
 */
export async function loadPlugin(
    install: LoadableBundle,
    options: CommitOptions,
): Promise<Plugin> {
    if (options.lane === "sandbox") {
        return sandboxPlugin(
            { manifest: install.manifest, bundle: install.bundle },
            options.sandboxHost,
        );
    }
    return importTrustedPlugin(install, options);
}

/** The trusted-lane half of {@link loadPlugin}: import in-page, then cross-check. */
async function importTrustedPlugin(
    install: LoadableBundle,
    options: CommitOptions,
): Promise<Plugin> {
    const blob = new Blob([install.bundle], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    let module: unknown;
    try {
        module = await import(/* @vite-ignore */ url);
    } catch (cause) {
        throw new InstallError(
            `The bundle failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    } finally {
        URL.revokeObjectURL(url);
    }

    const plugin = (module as { plugin?: unknown; default?: unknown })?.plugin ??
        (module as { default?: unknown })?.default;
    if (typeof plugin !== "object" || plugin === null) {
        throw new InstallError(`The bundle does not export a plugin.`);
    }
    const exported = plugin as { manifest?: unknown; install?: unknown };
    if (typeof exported.manifest !== "object" || exported.manifest === null) {
        throw new InstallError(`The bundle's plugin has no manifest.`);
    }
    if (typeof exported.install !== "function") {
        throw new InstallError(`The bundle's plugin has no install() function.`);
    }
    const exportedManifest = exported.manifest as PluginManifest;

    if (exportedManifest.id !== options.expectedId) {
        throw new InstallError(
            `The bundle declares plugin id "${exportedManifest.id}" but the manifest you ` +
                `consented to is "${options.expectedId}". Refusing to install.`,
        );
    }
    const declared = new Set(exportedManifest.permissions ?? []);
    const consented = new Set(install.manifest.permissions);
    for (const permission of declared) {
        if (!consented.has(permission)) {
            throw new InstallError(
                `The bundle asks for "${permission}", which the manifest you consented to ` +
                    `does not declare. Refusing to install.`,
            );
        }
    }

    return plugin as Plugin;
}
