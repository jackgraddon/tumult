/**
 * The first-party rich-activity document.
 *
 * This is the one shape Tumult writes to `app.tumult.activity`: a small,
 * namespaced extended-profile field (MSC4133). The shell owns the field so it
 * can enforce one rule a plugin cannot — native RPC/IPC activity wins over a
 * manual one, and the manual document comes back when the native source clears.
 *
 * Keep this module free of Vue and SDK imports: the controller, the renderer,
 * the settings page and their tests all read the same validation without
 * pulling a UI runtime into a pure test.
 */

export const ACTIVITY_FIELD_KEY = "app.tumult.activity";

export const ACTIVITY_TYPES = ["playing", "listening", "watching", "custom"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * One bounded image attached to an activity. Two at most: a large artwork and
 * an optional small badge, the way Discord draws rich presence. The URL is a
 * loadable `https:`/`http:`/`mxc:` URL (or a small `data:image/` URL); it is
 * always put in an `<img src>`, never in CSS, so hostile profile JSON cannot
 * inject markup or styles.
 */
export interface ActivityMedia {
    readonly url: string;
    readonly label?: string;
}

/** The structural shape of the shell's native feed — no plugin import needed. */
export interface NativeActivityLike {
    type: string;
    name: string;
    details?: string;
    state?: string;
    emoji?: string;
    startedAt?: number;
    endsAt?: number;
    media?: readonly ActivityMedia[];
}

export interface ActivityDocument {
    v: 1;
    type: ActivityType;
    name: string;
    details?: string;
    state?: string;
    emoji?: string;
    startedAt?: number;
    endsAt?: number;
    media?: readonly ActivityMedia[];
}

export interface ActivityInput {
    type: string;
    name: string;
    details?: string;
    state?: string;
    emoji?: string;
    startedAt?: number;
    endsAt?: number;
    media?: readonly ActivityMedia[];
}

const LIMITS = { name: 128, details: 128, state: 128, emoji: 16, mediaLabel: 128, url: 2048 } as const;
const MEDIA_MAX = 2;

function optionalText(value: unknown, limit: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" || trimmed.length > limit ? undefined : trimmed;
}

function validTimestamp(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** An empty optional string means "not set"; any other bad value is refused. */
function invalidOptional(value: unknown, parsed: string | undefined): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    return parsed === undefined;
}

function validMediaUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const url = value.trim();
    if (!url || url.length > LIMITS.url) return undefined;
    if (url.startsWith("mxc://")) return url;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
        // Small inline images are useful for fixture data and native producers
        // that already hold bytes; the length cap keeps profile JSON bounded.
        if (parsed.protocol === "data:" && /^data:image\//i.test(url)) return url;
    } catch {
        // Not a URL at all.
    }
    return undefined;
}

/** `undefined` means absent; `null` means the document must be refused. */
function parseMedia(value: unknown): readonly ActivityMedia[] | undefined | null {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.length > MEDIA_MAX) return null;
    const out: ActivityMedia[] = [];
    for (const entry of value) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
        const raw = entry as Record<string, unknown>;
        const url = validMediaUrl(raw["url"]);
        if (!url) return null;
        const label = optionalText(raw["label"], LIMITS.mediaLabel);
        if (invalidOptional(raw["label"], label)) return null;
        out.push(label ? { url, label } : { url });
    }
    return out.length ? out : undefined;
}

function isType(value: unknown): value is ActivityType {
    return typeof value === "string" && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/** Read a stored value defensively: another client may have written garbage. */
export function parseActivity(value: unknown): ActivityDocument | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw["v"] !== 1 || !isType(raw["type"])) return null;
    const name = optionalText(raw["name"], LIMITS.name);
    if (!name) return null;
    const details = optionalText(raw["details"], LIMITS.details);
    const state = optionalText(raw["state"], LIMITS.state);
    const emoji = optionalText(raw["emoji"], LIMITS.emoji);
    const startedAt = validTimestamp(raw["startedAt"]);
    const endsAt = validTimestamp(raw["endsAt"]);
    const media = parseMedia(raw["media"]);
    // Empty optional strings normalize to "absent", exactly like the released
    // plugin's validator. An over-long or wrongly typed value is still refused
    // rather than silently dropped, so bad field data is never rendered.
    if (invalidOptional(raw["details"], details)) return null;
    if (invalidOptional(raw["state"], state)) return null;
    if (invalidOptional(raw["emoji"], emoji)) return null;
    if (raw["startedAt"] !== undefined && startedAt === undefined) return null;
    if (raw["endsAt"] !== undefined && endsAt === undefined) return null;
    if (endsAt !== undefined && startedAt !== undefined && endsAt < startedAt) return null;
    if (media === null) return null;
    return {
        v: 1,
        type: raw["type"],
        name,
        ...(details ? { details } : {}),
        ...(state ? { state } : {}),
        ...(emoji ? { emoji } : {}),
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(media ? { media } : {}),
    };
}

/** Build a document from the settings form, throwing only on a bad name. */
export function createActivity(input: ActivityInput, now = Date.now()): ActivityDocument {
    const name = optionalText(input.name, LIMITS.name);
    if (!name) throw new Error("Enter a name for the activity.");
    const type = isType(input.type) ? input.type : "playing";
    const details = optionalText(input.details, LIMITS.details);
    const state = optionalText(input.state, LIMITS.state);
    const emoji = optionalText(input.emoji, LIMITS.emoji);
    const endsAt = validTimestamp(input.endsAt);
    const media = parseMedia(input.media);
    if (media === null) throw new Error("Attach at most two valid activity images.");
    return {
        v: 1,
        type,
        name,
        ...(details ? { details } : {}),
        ...(state ? { state } : {}),
        ...(emoji ? { emoji } : {}),
        startedAt: validTimestamp(input.startedAt) ?? now,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(media ? { media } : {}),
    };
}

/** Native activity uses the same wire shape, minus the schema version. */
export function activityFromNative(value: NativeActivityLike): ActivityDocument | null {
    // No coercion: a producer with an unknown type is refused rather than
    // silently shown as "Playing", matching the released plugin's validator.
    return parseActivity({ ...value, v: 1 });
}

export function sameActivity(a: ActivityDocument | null, b: ActivityDocument | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.type === b.type &&
        a.name === b.name &&
        a.details === b.details &&
        a.state === b.state &&
        a.emoji === b.emoji &&
        a.startedAt === b.startedAt &&
        a.endsAt === b.endsAt &&
        mediaEqual(a.media, b.media)
    );
}

function mediaEqual(a: readonly ActivityMedia[] | undefined, b: readonly ActivityMedia[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    return a.every((item, i) => item.url === b[i]!.url && item.label === b[i]!.label);
}

const HEADLINES: Record<ActivityType, string> = {
    playing: "Playing",
    listening: "Listening to",
    watching: "Watching",
    custom: "",
};

export function activityHeadline(value: ActivityDocument): string {
    const prefix = HEADLINES[value.type];
    return prefix ? `${prefix} ${value.name}` : value.name;
}

/** The plain-text mirror for clients that do not render rich activity. */
export function activityStatusText(value: ActivityDocument): string {
    const headline = activityHeadline(value);
    return value.emoji ? `${value.emoji} ${headline}` : headline;
}

export function activitySeconds(value: ActivityDocument): string {
    return [value.details, value.state].filter((part): part is string => Boolean(part)).join(" · ");
}

/** "18d 4h" / "2h 07m" / "just now" — empty when no reliable start is known. */
export function activityElapsed(value: ActivityDocument, now = Date.now()): string {
    if (value.startedAt === undefined || value.startedAt > now) return "";
    const minutes = Math.floor((now - value.startedAt) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface ActivityProgress {
    /** 0–100, clamped — an inline bar width never needs an unbounded value. */
    readonly percent: number;
    readonly elapsed: string;
    readonly duration: string;
    readonly ended: boolean;
}

function clockTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * A bounded, live progress view. Both ends must be present: an `endsAt` alone
 * would put a countdown on a card with no start, and a `startedAt` alone keeps
 * the existing "elapsed" text rather than inventing a duration.
 */
export function activityProgress(value: ActivityDocument, now = Date.now()): ActivityProgress | null {
    if (value.startedAt === undefined || value.endsAt === undefined) return null;
    const duration = value.endsAt - value.startedAt;
    if (duration <= 0) return null;
    const elapsed = Math.max(0, Math.min(duration, now - value.startedAt));
    return {
        percent: Math.min(100, Math.max(0, (elapsed / duration) * 100)),
        elapsed: clockTime(elapsed),
        duration: clockTime(duration),
        ended: now >= value.endsAt,
    };
}
