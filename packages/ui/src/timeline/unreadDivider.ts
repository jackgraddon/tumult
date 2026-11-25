/**
 * Where the "New messages" divider belongs in a loaded timeline, or -1.
 *
 * `m.fully_read` is a POSITION, not a count. Everything after it is new to the
 * server, but our own sends are never unread: anchoring the divider to the
 * first row after the marker put a "New messages" line underneath our own
 * messages whenever the marker lagged behind a send, where it stayed until
 * somebody else posted and re-ran the read path. Skip our own sends and land
 * on the first message from somebody else — the same rule the unread count
 * uses. A marker outside the loaded window has nothing to anchor to.
 */
export function unreadDividerIndex(
    messages: readonly { id: string; senderId: string }[],
    fullyReadEventId: string | null | undefined,
    ownUserId: string | null | undefined,
): number {
    if (!fullyReadEventId) return -1;
    const marker = messages.findIndex((m) => m.id === fullyReadEventId);
    if (marker < 0) return -1;
    for (let i = marker + 1; i < messages.length; i++) {
        const message = messages[i];
        if (message && ownUserId != null && message.senderId === ownUserId) continue;
        return i;
    }
    return -1;
}
