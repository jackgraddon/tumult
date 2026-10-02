import { EventType, MsgType, RelationType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";

export interface EditRecord {
    body: string;
    senderId: string;
}

/**
 * Collect `m.replace` edits by target event id. Timeline order decides:
 * later entries overwrite earlier ones, so the last eligible edit wins.
 * Skips redacted edits, malformed payloads and non-message events. Sender
 * matching happens at apply time (the feed knows the target's sender).
 * Exported for tests.
 */
export function collectEdits(events: readonly MatrixEvent[]): ReadonlyMap<string, EditRecord> {
    const out = new Map<string, EditRecord>();
    for (const event of events) {
        if (event.getType() !== EventType.RoomMessage || event.isRedacted()) continue;
        const relation = event.getRelation();
        if (relation?.rel_type !== RelationType.Replace || !relation.event_id) continue;
        const replacement = event.getContent()["m.new_content"];
        const body =
            typeof replacement === "object" && replacement !== null
                ? (replacement as Record<string, unknown>)["body"]
                : undefined;
        const senderId = event.getSender();
        if (typeof body !== "string" || body.length === 0 || !senderId) continue;
        out.set(relation.event_id, { body, senderId });
    }
    return out;
}

/**
 * Send an `m.replace` edit for our message. Thin like `sendTextMessage`:
 * the feed applies it (including the optimistic local echo). Kept separate
 * so the content shape is unit-testable without a homeserver.
 */
export async function sendEditMessage(
    matrix: MatrixClient,
    roomId: string,
    targetEventId: string,
    newBody: string,
): Promise<void> {
    await matrix.sendMessage(roomId, {
        msgtype: MsgType.Text,
        body: `* ${newBody}`,
        "m.new_content": { msgtype: MsgType.Text, body: newBody },
        "m.relates_to": { rel_type: RelationType.Replace, event_id: targetEventId },
    });
}
