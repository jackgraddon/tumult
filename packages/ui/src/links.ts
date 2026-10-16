/**
 * `matrix.to` permalinks.
 *
 * The one thing every context menu's "Copy link" needs, in one place: a room
 * link prefers the canonical alias (readable, and what other clients show),
 * while an event link is always id-based because an alias can be reassigned.
 * Nothing here needs the network — the link is built from state we already
 * hold, so a menu can offer it without a round trip.
 */

/** `https://matrix.to/#/{roomId}/{eventId}` — the room half is required. */
export function matrixEventLink(roomId: string, eventId: string): string {
    return `https://matrix.to/#/${roomId}/${eventId}`;
}

/**
 * `https://matrix.to/#/{alias-or-id}`. The alias is preferred when the room
 * has one; the id always resolves, so the link never needs a second thought
 * about the alias being stale or removed.
 */
export function matrixRoomLink(roomId: string, canonicalAlias?: string | null): string {
    const target = canonicalAlias && canonicalAlias.length > 0 ? canonicalAlias : roomId;
    return `https://matrix.to/#/${target}`;
}

/** `https://matrix.to/#/{userId}`. */
export function matrixUserLink(userId: string): string {
    return `https://matrix.to/#/${userId}`;
}
