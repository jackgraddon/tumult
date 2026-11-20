/**
 * Discord RPC over IPC: the pure wire protocol and the translation from a
 * Discord `SET_ACTIVITY` into our native activity feed.
 *
 * Discord-compatible producers (Cider, games, editors) speak a local socket,
 * not Tumult's own newline-JSON RPC. This module is the shared, Electron-free
 * half a Discord IPC server needs: frame framing/opcodes, the handshake reply,
 * command replies, and the activity mapping. `discord-ipc-server.ts` adds the
 * socket/named-pipe listening side, the way `native-activity.ts` adds `net` to
 * `native-wire.ts`.
 *
 * Wire format (little-endian): `uint32 opcode`, `uint32 length`, then `length`
 * bytes of JSON. Opcodes: 0 HANDSHAKE, 1 FRAME, 2 CLOSE, 3 PING, 4 PONG.
 * The first frame from a producer is a HANDSHAKE; after our READY dispatch it
 * sends FRAME commands (`SET_ACTIVITY`) and expects a FRAME reply echoing the
 * nonce. No Discord account, app registration or network access is involved —
 * this is a local presence sink.
 */

import { validateNativeActivity, type NativeActivity } from "./native-wire.ts";

export const DISCORD_OP = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4,
} as const;

/** A decoded IPC frame. Payloads are JSON objects; unknown shapes are ignored. */
export interface DiscordFrame {
    opcode: number;
    payload: Record<string, unknown> | null;
}

/** One producer change: a validated activity, an explicit clear, or nothing. */
export type DiscordActivityChange =
    | { kind: "set"; activity: NativeActivity }
    | { kind: "clear" }
    | { kind: "ignore" };

/** A frame can never exceed this; an oversized length is skipped, not buffered. */
const MAX_FRAME = 1024 * 1024;

/** Incremental frame reader: feed it socket chunks, get back whole frames. */
export class DiscordFrameFramer {
    private pending = Buffer.alloc(0);

    push(chunk: Buffer): DiscordFrame[] {
        const input = Buffer.from(chunk);
        this.pending = this.pending.length ? Buffer.concat([this.pending, input]) : input;
        const out: DiscordFrame[] = [];
        for (;;) {
            if (this.pending.length < 8) break;
            const opcode = this.pending.readUInt32LE(0);
            const length = this.pending.readUInt32LE(4);
            if (length > MAX_FRAME) {
                // A producer claiming a giant payload is broken, not a frame to
                // wait out: drop this whole chunk and resynchronise on the next
                // one. Waiting `length` bytes would let one bad header stall the
                // framer forever (and bias a hostile length toward MAX_INT).
                this.pending = Buffer.alloc(0);
                break;
            }
            if (this.pending.length < 8 + length) break;
            const raw = this.pending.subarray(8, 8 + length).toString("utf8");
            this.pending = this.pending.subarray(8 + length);
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch {
                continue;
            }
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                out.push({ opcode, payload: parsed as Record<string, unknown> });
            } else {
                out.push({ opcode, payload: null });
            }
        }
        // A malformed producer that never sends a header cannot grow the buffer.
        if (this.pending.length > MAX_FRAME + 8) this.pending = Buffer.alloc(0);
        return out;
    }
}

/** Build one framed IPC message. */
export function encodeDiscordFrame(opcode: number, payload: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(payload ?? {}), "utf8");
    const frame = Buffer.allocUnsafe(8 + body.length);
    frame.writeUInt32LE(opcode >>> 0, 0);
    frame.writeUInt32LE(body.length, 4);
    body.copy(frame, 8);
    return frame;
}

/** The READY dispatch a Discord client would send after a good handshake. */
export function handshakeReply(): Buffer {
    return encodeDiscordFrame(DISCORD_OP.FRAME, {
        cmd: "DISPATCH",
        data: {
            v: 1,
            config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
            user: { id: "0", username: "Tumult", discriminator: "0", avatar: null },
        },
        evt: "READY",
    });
}

/** Acknowledge a producer command, echoing its nonce so it believes the call worked. */
export function commandReply(payload: Record<string, unknown> | null): Buffer | null {
    if (!payload || typeof payload.cmd !== "string") return null;
    const reply: Record<string, unknown> = { cmd: payload.cmd, data: null, evt: null };
    if (typeof payload.nonce === "string") reply.nonce = payload.nonce;
    return encodeDiscordFrame(DISCORD_OP.FRAME, reply);
}

function text(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function object(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Discord's activity types: Playing, Streaming, Listening, Watching, Competing. */
function activityType(value: unknown): NativeActivity["type"] | null {
    switch (value) {
        case 0:
        case "playing":
            return "playing";
        case 1:
        case "streaming":
            return "watching";
        case 2:
        case "listening":
            return "listening";
        case 3:
        case "watching":
            return "watching";
        case 4:
        case "custom":
        case 5:
        case "competing":
            return "custom";
        default:
            return null;
    }
}

/**
 * Translate a SET_ACTIVITY frame. A null activity is an explicit clear; an
 * unparseable one is ignored (never clear the feed on a producer's garbage).
 *
 * Music producers put the track in `details` and the artist in `state`, so for
 * listening activities the track becomes the headline ("Listening to X") and
 * the artist the second line. For games the Discord `name` (the application)
 * is the headline. Extra Discord-only fields (party, secrets, images) are
 * deliberately dropped: our renderer draws a one-line status, not a card.
 */
export function activityFromSetActivity(payload: Record<string, unknown> | null): DiscordActivityChange {
    if (!payload || payload.cmd !== "SET_ACTIVITY") return { kind: "ignore" };
    const args = object(payload.args);
    if (!args || !("activity" in args)) return { kind: "ignore" };
    const raw = args.activity;
    if (raw === null || raw === undefined) return { kind: "clear" };
    const discord = object(raw);
    if (!discord) return { kind: "ignore" };

    const type = activityType(discord.type) ?? "playing";
    const details = text(discord.details);
    const state = text(discord.state);
    const assets = object(discord.assets);
    const largeText = text(assets?.large_text);
    const appName = text(discord.name);
    const emoji = text(object(discord.emoji)?.name);

    // For music, `details` is normally the song; a game's `details` is a
    // description, where the application name is the better headline.
    const name =
        type === "listening"
            ? details ?? appName ?? largeText ?? state
            : appName ?? details ?? largeText ?? state;
    const second = type === "listening" ? state ?? largeText : details;
    if (!name) return { kind: "ignore" };

    const timestamps = object(discord.timestamps);
    const start = timestamps?.start;
    const startedAt = typeof start === "number" && Number.isFinite(start) && start > 0 ? start * 1000 : undefined;

    const activity = validateNativeActivity({
        type,
        name,
        details: second === name ? undefined : second,
        state: type === "listening" && largeText && largeText !== name && largeText !== second ? largeText : undefined,
        startedAt,
        emoji,
    });
    return activity ? { kind: "set", activity } : { kind: "ignore" };
}
