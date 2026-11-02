/**
 * The native activity RPC, its pure wire protocol — the part that knows nothing
 * of Electron or even of running *on* a machine.
 *
 * A desktop app pushes "what I'm doing" into Tumult over a loopback connection:
 * one newline-terminated JSON object per change,
 *
 *   {"op":"set","value":{"type":"playing","name":"VLC","details":"…"}}
 *   {"op":"clear"}
 *
 * and the app on the receiving end (the server in `native-activity.ts`) turns
 * each into a feed change. This module is the shared half both sides speak —
 * the message shape, the validation, the newline framing and the port choice —
 * so a native producer (a client, or the reference demo in `demo/`) and the
 * server can never drift on the format. It is the part a real native app links
 * against; it is therefore free of `node:net`, Electron and the main process's
 * IPC channel, so it is the "template real apps copy". The server adds the
 * `net` listening side and the `NATIVE_ACTIVITY_IPC` broadcast on top of it.
 */

/**
 * One native/RPC activity, the rich-presence vocabulary on the wire. Mirrors the
 * rich-presence plugin's `NativeActivity` (and the feed's same-named type): the
 * host has no notion of a `source` or `assets`, because producers coordinate
 * client-side (last-writer-wins), the way a manual `/activity` and a native one
 * do. Field caps are enforced by the producer before it reaches the host, and
 * {@link validateNativeActivity} re-checks them so a malformed push never lands
 * on the feed.
 */
export interface NativeActivity {
    /** What the app is doing — the rich-presence vocabulary. */
    type: "playing" | "listening" | "watching" | "custom";
    /** The headline, e.g. "Visual Studio Code", "VLC", "Spotify". */
    name: string;
    /** A second line of context, e.g. a file or track name. */
    details?: string;
    /** A third line, e.g. a progress or current state. */
    state?: string;
    /** Epoch milliseconds the activity started, when the caller knows it. */
    startedAt?: number;
    /** A short emoji to show by the headline. */
    emoji?: string;
}

/** The rich-presence types a native app may push. */
export const NATIVE_ACTIVITY_TYPES = ["playing", "listening", "watching", "custom"] as const;

/** Field caps, kept in sync with the rich-presence plugin's `LIMITS`. */
const NAME_MAX = 128;
const LINE_MAX = 256;
const EMOJI_MAX = 32;

/** A single wire message: a `set` with a `value`, or a bare `clear`. */
export interface NativeActivityMessage {
    op: "set" | "clear";
    value?: unknown;
}

/**
 * Whether `raw` is the `value` of a `set` message, and if so the normalized
 * activity. Trims each string, drops empty optionals, caps lengths, and requires
 * a known `type` and a non-empty `name` (1–{@link NAME_MAX}). Any other shape is
 * not an activity, so a caller leaves the field as it was rather than clearing
 * it on garbage.
 */
export function validateNativeActivity(raw: unknown): NativeActivity | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const any = raw as Record<string, unknown>;

    const type = any.type;
    if (typeof type !== "string" || !(NATIVE_ACTIVITY_TYPES as readonly string[]).includes(type)) return null;

    const name = trimLen(any.name, NAME_MAX);
    if (!name) return null;

    const activity: NativeActivity = { type: type as NativeActivity["type"], name };
    const details = trimLen(any.details, LINE_MAX);
    const state = trimLen(any.state, LINE_MAX);
    const emoji = trimLen(any.emoji, EMOJI_MAX);
    // `exactOptionalPropertyTypes`: only ever set when non-empty.
    if (details) activity.details = details;
    if (state) activity.state = state;
    if (emoji) activity.emoji = emoji;
    if (typeof any.startedAt === "number" && Number.isFinite(any.startedAt)) activity.startedAt = any.startedAt as number;
    return activity;
}

/** Trim and cap a string field; empty or non-string → `undefined` (dropped). */
function trimLen(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The wire framing both sides speak: a newline-terminated JSON object.
 * `encodeNativeActivity` / {@link encodeNativeClear} build the two kinds of
 * frame the producer sends; they validate the `set` value here so a producer
 * cannot frame a malformed activity (the server re-validates — defence in depth,
 * not the sole guard).
 */

/** The frame a producer sends to report an activity. `null` when it is not a valid one. */
export function encodeNativeActivity(activity: unknown): string | null {
    const value = validateNativeActivity(activity);
    if (!value) return null;
    return `${JSON.stringify({ op: "set", value })}\n`;
}

/** The frame a producer sends to clear. */
export function encodeNativeClear(): string {
    return `${JSON.stringify({ op: "clear" })}\n`;
}

/**
 * A newline-framed reader: feed it `Socket`'s `data` chunks and it yields the
 * complete JSON text of every whole line received so far, holding back a partial
 * final line for the next chunk. A line longer than {@link MAX_LINE} (with no
 * newline) is dropped, so a producer that never terminates its frames cannot
 * grow the buffer without bound.
 */
const MAX_LINE = 64 * 1024;

export class LineFramer {
    private pending = Buffer.alloc(0);

    /** Push a read chunk; returns the complete line texts it now holds. */
    push(chunk: Buffer): string[] {
        this.pending = Buffer.concat([this.pending, chunk]);
        const out: string[] = [];
        let newline = this.pending.indexOf(0x0a);
        while (newline !== -1) {
            const line = this.pending.subarray(0, newline).toString("utf8");
            this.pending = this.pending.subarray(newline + 1);
            out.push(line);
            newline = this.pending.indexOf(0x0a);
        }
        // Guard a never-terminated, ever-growing final partial line.
        if (this.pending.length > MAX_LINE) this.pending = Buffer.alloc(0);
        return out;
    }
}

/** Parse and validate one whole wire line; `null` when it is not a message. */
export function parseNativeActivityLine(line: string): NativeActivityMessage | null {
    let message: unknown;
    try {
        message = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
    const any = message as Record<string, unknown>;
    if (any.op === "clear") return { op: "clear" };
    if (any.op === "set") return { op: "set", value: any.value };
    return null;
}

/**
 * The port to bind or connect to, from the environment. A fixed loopback port
 * lets a co-located native app find the app; `TUMULT_NATIVE_ACTIVITY_PORT`
 * overrides it (the smoke test uses an ephemeral one so CI never collides with a
 * running app). An empty/invalid value keeps the default.
 */
const DEFAULT_PORT = 18731;

export function resolveNativeActivityPort(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.TUMULT_NATIVE_ACTIVITY_PORT;
    if (!raw) return DEFAULT_PORT;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}
