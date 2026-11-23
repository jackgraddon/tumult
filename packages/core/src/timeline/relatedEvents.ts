import type { RelatedEventKind, RelatedEventView } from "../contract.ts";

/** Exact event types we understand well enough to fold onto their target. */
export const BEEPER_SEND_STATUS = "com.beeper.message_send_status";
export const BEEPER_VIEW_LIMITED = "com.beeper.view_limited";
export const POLL_RESPONSE_TYPES = new Set(["m.poll.response", "org.matrix.msc3381.poll.response"]);

/** Bound the long tail so a busy bridge cannot grow a row without limit. */
export const MAX_RELATED_PER_TARGET = 12;
export const MAX_ORPHAN_RELATED = 200;

/** Structural surface needed to classify one timeline event. */
export interface RelatedEventSource {
    getId(): string | undefined;
    getType(): string;
    getSender(): string | undefined;
    getTs(): number;
    getContent(): Record<string, unknown>;
    // Optional for the minimal event stubs used by unit tests; every real
    // MatrixEvent has them, but a state-less event stub still maps fine.
    getRelation?(): { rel_type?: string; event_id?: string; key?: string } | null | undefined;
    isRedacted?(): boolean;
    getStateKey?(): string | null | undefined;
}

export interface RelatedEventCollection {
    /** Events to attach, keyed by their target event id, newest first. */
    byTarget: ReadonlyMap<string, RelatedEventView[]>;
    /** Event objects that must not render as their own rows. */
    recognized: ReadonlySet<RelatedEventSource>;
}

/**
 * Future bridges can be supported without a code change when their event type
 * says it is metadata. This is deliberately semantic: a custom game move or a
 * card with an `m.reference` does not match and keeps its own timeline row.
 */
const METADATA_TYPE_HINT =
    /(?:^|\.)(?:status|statuses|delivery|delivered|receipt|receipts|ack|acked|acknowledged|acknowledgement|view_limited|vote|votes|response|responses|stream|stream_chunk|chunk)(?:\.|$)/i;

const NEVER_GENERIC = new Set([
    "m.room.message",
    "m.room.encrypted",
    "m.reaction",
    "m.room.redaction",
    "m.poll.start",
    "m.poll.end",
    "org.matrix.msc3381.poll.start",
    "org.matrix.msc3381.poll.end",
    "com.beeper.transcription",
    "org.matrix.msc4075.rtc.notification",
    "org.matrix.msc4310.rtc.decline",
    "m.rtc.invite",
    "m.rtc.decline",
]);

/** Keys that mean an event is a message, not metadata about another message. */
const VISIBLE_CONTENT_KEYS = new Set([
    "body",
    "msgtype",
    "formatted_body",
    "format",
    "url",
    "file",
    "filename",
    "info",
    "thumbnail_url",
    "thumbnail_file",
    "m.new_content",
]);

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function abbreviate(value: string, limit = 140): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function networkLabel(content: Readonly<Record<string, unknown>>): string {
    const raw = text(content["network"]);
    if (!raw) return "the bridge";
    switch (raw.toLowerCase()) {
        case "imessage":
            return "iMessage";
        case "gmessages":
            return "Google Messages";
        case "whatsapp":
            return "WhatsApp";
        case "telegram":
            return "Telegram";
        default:
            return raw;
    }
}

/**
 * Accept both the modern `status` enum and the legacy booleans some older
 * mautrix bridges still send. The historical `PENDNIG` typo is real.
 */
export function beeperStatus(content: Readonly<Record<string, unknown>>): string | null {
    const raw = text(content["status"])?.toUpperCase();
    if (raw === "PENDNIG") return "PENDING";
    if (raw) return raw;
    if (content["success"] === true) return "SUCCESS";
    if (content["can_retry"] === true) return "FAIL_RETRIABLE";
    if (content["success"] === false) return "FAIL_PERMANENT";
    return null;
}

function deliveredCount(content: Readonly<Record<string, unknown>>): number | null {
    const users = content["delivered_to_users"];
    if (!Array.isArray(users)) return null;
    return users.filter((u): u is string => typeof u === "string").length;
}

/**
 * Only the bridge's `message` is user-facing copy. `error` and
 * `internal_error` are diagnostics and must never appear in the timeline.
 */
export function beeperSummary(content: Readonly<Record<string, unknown>>): string {
    const network = networkLabel(content);
    const human = text(content["message"]);
    const delivered = deliveredCount(content);
    switch (beeperStatus(content)) {
        case "PENDING":
            return `Sending via ${network}…`;
        case "SUCCESS":
            return delivered !== null && delivered > 0
                ? `Delivered via ${network} to ${delivered} ${delivered === 1 ? "person" : "people"}`
                : `Sent via ${network}`;
        case "FAIL_RETRIABLE":
        case "FAIL_PERMANENT":
            return human ? `Couldn't send via ${network}: ${abbreviate(human)}` : `Couldn't send via ${network}`;
        default:
            return human
                ? `Bridge update via ${network}: ${abbreviate(human)}`
                : `Bridge status updated via ${network}`;
    }
}

function genericSummary(content: Readonly<Record<string, unknown>>): string | null {
    for (const key of ["message", "status", "state", "reason", "outcome", "result"] as const) {
        const value = text(content[key]);
        if (value) return `Related update: ${abbreviate(value)}`;
    }
    const count = content["count"] ?? content["remaining_count"];
    if (typeof count === "number" && Number.isFinite(count)) return `Related update: ${count}`;
    return null;
}

/** Small, shallow, JSON-only payloads are the only ones we auto-fold. */
function isSmallJson(value: unknown, depth = 0): boolean {
    if (value === null || typeof value === "boolean" || typeof value === "number") return true;
    if (typeof value === "string") return value.length <= 1024;
    if (depth >= 4) return false;
    if (Array.isArray(value)) {
        return value.length <= 32 && value.every((item) => isSmallJson(item, depth + 1));
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        return (
            entries.length <= 32 &&
            entries.every(([key, item]) => key.length <= 128 && isSmallJson(item, depth + 1))
        );
    }
    return false;
}

function hasMetadataPayload(content: Readonly<Record<string, unknown>>): boolean {
    for (const key of Object.keys(content)) {
        if (key === "m.relates_to") continue;
        if (VISIBLE_CONTENT_KEYS.has(key)) return false;
    }
    // A bare reference with no metadata is a context link, not a status update.
    return Object.keys(content).some((key) => key !== "m.relates_to");
}

function isNeverGeneric(type: string): boolean {
    return (
        NEVER_GENERIC.has(type) ||
        type.startsWith("m.") ||
        type.startsWith("m.call.") ||
        type.startsWith("m.key.verification.")
    );
}

function classified(
    type: string,
    content: Readonly<Record<string, unknown>>,
): { kind: RelatedEventKind; summary: string | null } | null {
    if (type === BEEPER_SEND_STATUS) {
        return { kind: "delivery", summary: beeperSummary(content) };
    }
    if (type === BEEPER_VIEW_LIMITED) {
        const remaining = content["remaining_count"];
        return {
            kind: "view-limited",
            summary:
                typeof remaining === "number" && Number.isFinite(remaining)
                    ? `${remaining} more ${remaining === 1 ? "message is" : "messages are"} hidden by the bridge`
                    : "More messages are hidden by the bridge",
        };
    }
    if (POLL_RESPONSE_TYPES.has(type)) {
        return { kind: "poll-vote", summary: "Vote recorded" };
    }
    // Auto-support: a future namespaced event is metadata only when BOTH its
    // type says so and its payload looks like a small status update. Shape
    // alone never earns the right to hide an event.
    if (
        !isNeverGeneric(type) &&
        METADATA_TYPE_HINT.test(type) &&
        hasMetadataPayload(content) &&
        isSmallJson(content)
    ) {
        return { kind: "metadata", summary: genericSummary(content) };
    }
    return null;
}

function newestFirst(list: RelatedEventView[]): RelatedEventView[] {
    return list.sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? -1 : 1));
}

function cap(list: RelatedEventView[]): RelatedEventView[] {
    if (list.length <= MAX_RELATED_PER_TARGET) return list;
    return list.slice(0, MAX_RELATED_PER_TARGET);
}

/**
 * Collect metadata events that belong to another message.
 *
 * We deliberately require an explicit wire reference (`m.relates_to.rel_type`),
 * not merely the presence of `m.relates_to`: replies, threads and contextual
 * links all use relations but are messages in their own right. `getRelation()`
 * reads the cleartext relation even while an event is still encrypted; an
 * encrypted event whose type/payload has not been decrypted yet cannot be
 * shaped-checked, so it stays a pending row until the decrypt signal rebuilds
 * the snapshot.
 */
export function collectRelatedEvents(
    events: readonly RelatedEventSource[],
): RelatedEventCollection {
    const byTarget = new Map<string, RelatedEventView[]>();
    const recognized = new Set<RelatedEventSource>();

    for (const event of events) {
        if (event.getStateKey?.() != null || event.isRedacted?.()) continue;
        const type = event.getType();
        if (type === "m.room.encrypted") continue;
        const relation = event.getRelation?.();
        if (relation?.rel_type !== "m.reference" || !relation.event_id) continue;
        const content = event.getContent() ?? {};
        const info = classified(type, content);
        if (!info) continue;

        const senderId = event.getSender();
        if (!senderId) continue;
        const view: RelatedEventView = {
            id: event.getId() ?? `related:${event.getTs()}:${type}`,
            type,
            relationType: relation.rel_type,
            targetId: relation.event_id,
            senderId,
            timestamp: event.getTs(),
            kind: info.kind,
            summary: info.summary,
            content: Object.freeze({ ...content }),
        };
        recognized.add(event);
        const list = byTarget.get(view.targetId) ?? [];
        list.push(view);
        byTarget.set(view.targetId, cap(newestFirst(list)));
    }
    return { byTarget, recognized };
}

/** Merge buffered events for targets not yet in the window, newest first. */
export function mergeRelatedEvents(
    primary: ReadonlyMap<string, readonly RelatedEventView[]>,
    buffered: ReadonlyMap<string, readonly RelatedEventView[]>,
): Map<string, RelatedEventView[]> {
    const out = new Map<string, RelatedEventView[]>();
    for (const [targetId, entries] of primary) {
        out.set(targetId, cap(newestFirst([...entries])));
    }
    for (const [targetId, entries] of buffered) {
        const list = out.get(targetId) ?? [];
        const known = new Set(list.map((entry) => entry.id));
        for (const entry of entries) {
            if (known.has(entry.id)) continue;
            known.add(entry.id);
            list.push(entry);
        }
        out.set(targetId, cap(newestFirst(list)));
    }
    return out;
}

/** Keep the orphan buffer bounded across a long-lived room feed. */
export function capOrphans(
    map: ReadonlyMap<string, readonly RelatedEventView[]>,
): Map<string, RelatedEventView[]> {
    const out = new Map<string, RelatedEventView[]>();
    let total = 0;
    for (const [targetId, entries] of map) {
        if (total >= MAX_ORPHAN_RELATED) break;
        const take = Math.min(entries.length, MAX_ORPHAN_RELATED - total);
        out.set(targetId, entries.slice(0, take));
        total += take;
    }
    return out;
}
