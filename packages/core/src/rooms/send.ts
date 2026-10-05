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
