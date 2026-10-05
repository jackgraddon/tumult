import { EventStatus } from "matrix-js-sdk";

import type { DecryptionStatus, MessageStatus, MessageView, ReplyView } from "../contract.ts";

/** Minimal structural surface the mapper needs — stubs satisfy this in tests. */
export interface MappableEvent {
    getId(): string | undefined;
    getType(): string;
    getSender(): string | undefined;
    /** Member state at this event; absent for stubs and some local echoes. */
    sender?: { name?: string; getMxcAvatarUrl(): string | undefined | null } | null;
    getTs(): number;
    getContent(): Record<string, unknown>;
    isEncrypted(): boolean;
    isDecryptionFailure(): boolean;
    isRedacted(): boolean;
    status: EventStatus | null;
    /**
     * Clear (decrypted or plaintext) event. Absent while an encrypted event
     * still awaits its keys — `isEncrypted()` stays true even AFTER a
     * successful decryption (it reads the wire type), so this field, not
     * `isEncrypted()`, separates `pending` from `ok`.
     */
    clearEvent: unknown;
}

function toStatus(status: EventStatus | null): MessageStatus {
    switch (status) {
        case null:
            return "sent";
        case EventStatus.NOT_SENT:
        case EventStatus.CANCELLED:
            return "failed";
        default:
            return "sending";
    }
}

function toDecryption(event: MappableEvent): DecryptionStatus {
    if (event.isDecryptionFailure()) return "failed";
    if (event.isEncrypted() && event.clearEvent == null) return "pending";
    return "ok";
}

function toBody(event: MappableEvent, content: Record<string, unknown>): string {
    if (event.isRedacted()) return "Message deleted.";
    const body = content["body"];
    if (typeof body === "string" && body.length > 0) return body;
    // Non-text events (stickers, calls, tombstones): honest label, never raw JSON.
    return `[${event.getType()}]`;
}

function mxcOrNull(url: string | null | undefined): string | null {
    return typeof url === "string" && url.startsWith("mxc://") ? url : null;
}

/**
 * Event id of the inline reply target in this content, or null.
 *
 * Reads `m.relates_to.m.in_reply_to` directly — `getRelation()` can't help
 * here: it requires a `rel_type`, and a plain reply has none (it is the
 * `m.in_reply_to` object itself, not a typed relation).
 *
 * Thread relations also carry `m.in_reply_to`, but for unthreaded clients the
 * SDK auto-falls-back one onto EVERY thread message (`is_falling_back: true`).
 * Treating those as inline replies would quote the previous message on every
 * thread row, so only a bare reply or an explicit one (`is_falling_back:
 * false`) counts. Exported for tests.
 */
export function replyTargetId(content: Record<string, unknown>): string | null {
    const rel = content["m.relates_to"];
    if (typeof rel !== "object" || rel === null) return null;
    const relates = rel as Record<string, unknown>;
    if (relates["rel_type"] != null && relates["is_falling_back"] !== false) return null;
    const inReplyTo = relates["m.in_reply_to"];
    if (typeof inReplyTo !== "object" || inReplyTo === null) return null;
    const eventId = (inReplyTo as Record<string, unknown>)["event_id"];
    return typeof eventId === "string" && eventId.length > 0 ? eventId : null;
}

/**
 * Split a rich-reply body into its fallback-free text plus the quoted sender.
 *
 * The spec's fallback is `> `-prefixed lines (the first one carrying the
 * sender's mxid in angle brackets), a blank line, then the reply itself;
 * clients MUST strip it before rendering. Stripped only when a relation says
 * this IS a reply — a plain message that happens to start with `> ` renders
 * verbatim. Exported for tests.
 */
export function stripReplyFallback(body: string): { senderId: string; body: string } {
    const lines = body.split("\n");
    let i = 0;
    let senderId = "";
    for (; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || !line.startsWith("> ")) break;
        if (i === 0) {
            const mention = /^> <([^>]+)> ?/.exec(line);
            if (mention) {
                senderId = mention[1] ?? "";
                lines[i] = line.slice(mention[0].length);
                continue;
            }
        }
        lines[i] = line.slice(2);
    }
    // The blank separator between quoted block and reply: drop it so the
    // reply doesn't render with a leading empty line.
    if (i > 0 && lines[i] === "") i++;
    return { senderId, body: lines.slice(i).join("\n") };
}

/**
 * Map one SDK event onto a contract snapshot. Pure: safe to call on every
 * invalidation signal and cheap enough to recompute whole timelines.
 */
export function mapEvent(event: MappableEvent): MessageView {
    const content = event.getContent() ?? {};
    // A redacted event's content is stripped, so there is nothing to parse.
    const targetId = event.isRedacted() ? null : replyTargetId(content);
    let body = toBody(event, content);
    let reply: ReplyView | null = null;
    if (targetId) {
        const stripped = stripReplyFallback(body);
        body = stripped.body;
        // Provisional: the feed overwrites sender/body with the target's own
        // (post-edit) values once the target is in the loaded window.
        reply = {
            eventId: targetId,
            senderId: stripped.senderId,
            senderName: stripped.senderId,
            body: stripped.body,
        };
    }
    return {
        id: event.getId() ?? `local:${event.getTs()}:${Math.random().toString(36).slice(2)}`,
        type: event.getType(),
        senderId: event.getSender() ?? "",
        senderName: event.sender?.name || event.getSender() || "",
        senderAvatarUrl: mxcOrNull(event.sender?.getMxcAvatarUrl()),
        body,
        timestamp: event.getTs(),
        status: toStatus(event.status),
        decryption: toDecryption(event),
        content: Object.freeze({ ...content }),
        // Filled by the feed, which sees the whole timeline. The mapper only
        // ever sees one event at a time.
        reply,
        reactions: [],
        readBy: [],
        edited: false,
        redacted: event.isRedacted(),
    };
}
