import { MsgType, type MatrixClient } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";

/**
 * Build the spec's rich-reply fallback body: each line of the original
 * prefixed `> ` (the first one carrying the sender's mxid in angle brackets),
 * a blank line, then the reply. Clients that don't understand relations
 * render this as a quoted block; ours strips it before display.
 * Exported for tests.
 */
export function buildReplyBody(original: string, reply: string, senderId: string): string {
    const mention = senderId.length > 0 ? `<${senderId}> ` : "";
    const quoted = original
        .split("\n")
        .map((line, i) => `> ${i === 0 ? mention : ""}${line}`)
        .join("\n");
    return `${quoted}\n\n${reply}`;
}

/**
 * Send one plaintext message. Thin on purpose: the SDK owns the local echo
 * lifecycle (insert → status flips → remote-echo replacement), and the feed
 * maps every transition. Kept separate from the client so the content shape
 * is unit-testable without a homeserver.
 *
 * With `replyToEventId` this sends a rich reply. The replied-to event is
 * looked up in the room to build the fallback quote and the mention — it is
 * on screen (that is where the reply affordance lives), so that is the normal
 * path; a missing target still sends a valid relation, just without fallback
 * text for old clients.
 */
export async function sendTextMessage(
    matrix: MatrixClient,
    roomId: string,
    body: string,
    replyToEventId?: string,
): Promise<void> {
    if (!replyToEventId) {
        await matrix.sendMessage(roomId, { msgtype: MsgType.Text, body });
        return;
    }
    const target = matrix.getRoom(roomId)?.findEventById(replyToEventId);
    const targetSender = target?.getSender() ?? "";
    let quoted = body;
    if (target && !target.isRedacted()) {
        // getContent() reads the decrypted body on encrypted events.
        const original = target.getContent()["body"];
        if (typeof original === "string" && original.length > 0) {
            quoted = buildReplyBody(original, body, targetSender);
        }
    }
    const content = {
        msgtype: MsgType.Text,
        body: quoted,
        "m.relates_to": { "m.in_reply_to": { event_id: replyToEventId } },
        // Spec: replying mentions the replied-to user so they get notified,
        // even when the reply text doesn't spell out their name.
        ...(targetSender ? { "m.mentions": { user_ids: [targetSender] } } : {}),
    } as RoomMessageEventContent;
    await matrix.sendMessage(roomId, content);
}

/**
 * Retry a failed plaintext send. The failed send is a pending event the SDK
 * left in `NOT_SENT` after its scheduler gave up — `resendEvent` re-sends that
 * event directly, and its content (body, reply relation, mention) is already
 * correct. The SDK's own backoff scheduler then retries it again, so this
 * respects the SDK's cycle instead of duplicating a send. The echo transition
 * (SENDING → SENT/failed) republishes through the feed.
 */
export function retryTextMessage(
    matrix: MatrixClient,
    roomId: string,
    eventId: string,
): Promise<void> {
    const room = matrix.getRoom(roomId);
    if (!room) return Promise.reject(new Error(`No such room ${roomId}`));
    const failed = room.getPendingEvents().find((e) => e.getId() === eventId);
    if (!failed) return Promise.reject(new Error(`No failed event ${eventId}`));
    // `resendEvent` returns void in SDK v43 — the echo transition (SENDING →
    // SENT/failed) republishes through the feed, not this promise.
    matrix.resendEvent(failed, room);
    return Promise.resolve();
}
