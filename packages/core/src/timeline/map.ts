import { EventStatus } from "matrix-js-sdk";

import type { DecryptionStatus, MessageStatus, MessageView } from "../contract.ts";

/** Minimal structural surface the mapper needs — stubs satisfy this in tests. */
export interface MappableEvent {
    getId(): string | undefined;
    getType(): string;
    getSender(): string | undefined;
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

/**
 * Map one SDK event onto a contract snapshot. Pure: safe to call on every
 * invalidation signal and cheap enough to recompute whole timelines.
 */
export function mapEvent(event: MappableEvent): MessageView {
    const content = event.getContent() ?? {};
    return {
        id: event.getId() ?? `local:${event.getTs()}:${Math.random().toString(36).slice(2)}`,
        type: event.getType(),
        senderId: event.getSender() ?? "",
        body: toBody(event, content),
        timestamp: event.getTs(),
        status: toStatus(event.status),
        decryption: toDecryption(event),
        content: Object.freeze({ ...content }),
        // Filled by the feed, which sees the whole timeline. The mapper only
        // ever sees one event at a time.
        reactions: [],
        readBy: [],
        edited: false,
    };
}
