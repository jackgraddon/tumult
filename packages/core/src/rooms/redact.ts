import type { MatrixClient } from "matrix-js-sdk";

/**
 * Redact (delete) an event. Only the server applies it: the local redaction
 * echo never renders (the timeline filter drops `m.room.redaction`) and the
 * target tombstones on the next sync, where `mapEvent` swaps its body for
 * "Message deleted.". Kept separate from the client so the call shape is
 * unit-testable without a homeserver.
 *
 * No relation hint is passed: a plain redaction of the event itself is the
 * whole v1 story (MSC3912 relation-based redactions would also kill edits
 * and reactions in one shot — a follow-up, not this).
 */
export async function redactEvent(
    matrix: MatrixClient,
    roomId: string,
    eventId: string,
    reason?: string,
): Promise<void> {
    if (reason === undefined) {
        await matrix.redactEvent(roomId, eventId);
        return;
    }
    await matrix.redactEvent(roomId, eventId, undefined, { reason });
}
