import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConnectionError, EventStatus, MatrixError, type MatrixClient } from "matrix-js-sdk";

import { resendAfterOutage } from "../src/rooms/send.ts";

/** A pending event as the SDK leaves it after a send settles: status + the error it hit. */
function pending(id: string, status: EventStatus, error: Error | null): { getId(): string; status: EventStatus; error: Error | null } {
    return { getId: () => id, status, error };
}

function stubClient(rooms: Record<string, ReturnType<typeof pending>[]>): { matrix: MatrixClient; resent: string[] } {
    const resent: string[] = [];
    const matrix = {
        getRooms: () => Object.entries(rooms).map(([roomId, events]) => ({ roomId, getPendingEvents: () => events })),
        resendEvent: (event: { getId(): string }, room: { roomId: string }) => {
            resent.push(`${room.roomId}/${event.getId()}`);
            return Promise.resolve();
        },
    } as unknown as MatrixClient;
    return { matrix, resent };
}

describe("resendAfterOutage", () => {
    it("resends what failed because the network was down", () => {
        const { matrix, resent } = stubClient({
            "!a": [pending("~1", EventStatus.NOT_SENT, new ConnectionError("fetch failed", new TypeError("Failed to fetch")))],
        });
        assert.equal(resendAfterOutage(matrix), 1);
        assert.deepEqual(resent, ["!a/~1"]);
    });

    it("leaves a message the server refused for the user to decide", () => {
        const refused = new MatrixError({ errcode: "M_FORBIDDEN", error: "You are not allowed to send" }, 403);
        const { matrix, resent } = stubClient({ "!a": [pending("~1", EventStatus.NOT_SENT, refused)] });
        assert.equal(resendAfterOutage(matrix), 0);
        assert.deepEqual(resent, []);
    });

    it("leaves messages that are still on their way, and covers every room", () => {
        const offline = (): Error => new ConnectionError("fetch failed");
        const { matrix, resent } = stubClient({
            "!a": [pending("~sending", EventStatus.SENDING, null), pending("~1", EventStatus.NOT_SENT, offline())],
            "!b": [pending("~2", EventStatus.NOT_SENT, offline()), pending("~queued", EventStatus.QUEUED, null)],
        });
        assert.equal(resendAfterOutage(matrix), 2);
        assert.deepEqual(resent, ["!a/~1", "!b/~2"]);
    });
});
