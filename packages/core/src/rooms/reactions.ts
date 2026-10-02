import { EventType, RelationType, type MatrixClient } from "matrix-js-sdk";

/**
 * Toggle our `emoji` reaction on a message: redacts our existing reaction
 * when present, otherwise sends a new `m.reaction` annotation. The feed maps
 * the result (including the optimistic local echo); this only issues the
 * request. Kept separate from the client so the routing is unit-testable
 * without a homeserver.
 */
export async function toggleReaction(
    matrix: MatrixClient,
    roomId: string,
    targetEventId: string,
    emoji: string,
): Promise<void> {
    const room = matrix.getRoom(roomId);
    if (!room) throw new Error(`Unknown room ${roomId}`);
    const ownUserId = matrix.getUserId();
    const existing = room
        .getLiveTimeline()
        .getEvents()
        .find((event) => {
            if (event.getType() !== EventType.Reaction || event.isRedacted()) return false;
            if (event.getSender() !== ownUserId) return false;
            const relation = event.getRelation();
            return (
                relation?.rel_type === RelationType.Annotation &&
                relation.event_id === targetEventId &&
                relation.key === emoji
            );
        });
    const existingId = existing?.getId();
    if (existingId) {
        await matrix.redactEvent(roomId, existingId);
        return;
    }
    await matrix.sendEvent(roomId, EventType.Reaction, {
        "m.relates_to": {
            rel_type: RelationType.Annotation,
            event_id: targetEventId,
            key: emoji,
        },
    });
}
