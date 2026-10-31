import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConnectionError, EventStatus, MatrixError, type MatrixClient } from "matrix-js-sdk";

import { resendAfterOutage } from "../src/rooms/send.ts";

/** An event as the SDK leaves it in the live timeline: a status (null = sent) and any send error. */
function event(id: string, status: EventStatus | null, error: Error | null = null): { getId(): string; status: EventStatus | null; error: Error | null } {
    return { getId: () => id, status, error };
}

/**
 * Rooms as the client really has them — `pendingEventOrdering: "chronological"`
 * (client.ts): echoes in the live timeline, getPendingEvents() throwing with
 * the SDK's own message. A stub that served getPendingEvents() is what hid
 * that "try again" (and the first version of this resend) always threw.
 */
function stubClient(rooms: Record<string, ReturnType<typeof event>[]>): { matrix: MatrixClient; resent: string[] } {
    const resent: string[] = [];
    const matrix = {
        getRooms: () =>
            Object.entries(rooms).map(([roomId, events]) => ({
                roomId,
                getLiveTimeline: () => ({ getEvents: () => events }),
                getPendingEvents: () => {
                    throw new Error("Cannot call getPendingEvents with pendingEventOrdering == chronological");
                },
            })),
        resendEvent: (e: { getId(): string }, room: { roomId: string }) => {
            resent.push(`${room.roomId}/${e.getId()}`);
            return Promise.resolve();
        },
    } as unknown as MatrixClient;
    return { matrix, resent };
}

const offline = (): Error => new ConnectionError("fetch failed", new TypeError("Failed to fetch"));

describe("resendAfterOutage", () => {
    it("resends what failed because the network was down", () => {
        const { matrix, resent } = stubClient({ "!a": [event("$sent", null), event("~1", EventStatus.NOT_SENT, offline())] });
        assert.equal(resendAfterOutage(matrix), 1);
        assert.deepEqual(resent, ["!a/~1"]);
    });

    it("leaves a message the server refused for the user to decide", () => {
        const refused = new MatrixError({ errcode: "M_FORBIDDEN", error: "You are not allowed to send" }, 403);
        const { matrix, resent } = stubClient({ "!a": [event("~1", EventStatus.NOT_SENT, refused)] });
        assert.equal(resendAfterOutage(matrix), 0);
        assert.deepEqual(resent, []);
    });

    it("leaves messages that are still on their way, and covers every room", () => {
        const { matrix, resent } = stubClient({
            "!a": [event("~sending", EventStatus.SENDING), event("~1", EventStatus.NOT_SENT, offline())],
            "!b": [event("~2", EventStatus.NOT_SENT, offline()), event("~queued", EventStatus.QUEUED)],
        });
        assert.equal(resendAfterOutage(matrix), 2);
        assert.deepEqual(resent, ["!a/~1", "!b/~2"]);
    });
});
