import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { createFakeChatClient } from "../src/fake/index.ts";
import { readOwnPresence } from "../src/rooms/own-presence.ts";

function stubMatrix(
    status: { presence: "online" | "offline" | "unavailable"; status_msg?: string } | Error,
    userId: string | null = "@alice:example.com",
): MatrixClient & { reads: string[] } {
    const reads: string[] = [];
    const matrix = {
        getUserId: () => userId,
        getPresence: async (id: string) => {
            reads.push(id);
            if (status instanceof Error) throw status;
            return status;
        },
        reads,
    };
    return matrix as unknown as MatrixClient & { reads: string[] };
}

describe("readOwnPresence", () => {
    it("reads the status for our own user", async () => {
        const matrix = stubMatrix({ presence: "online", status_msg: "Listening to Kite" });
        assert.deepEqual(await readOwnPresence(matrix), {
            presence: "online",
            statusMessage: "Listening to Kite",
        });
        assert.deepEqual(matrix.reads, ["@alice:example.com"]);
    });

    it("maps an absent status_msg to null rather than an empty string", async () => {
        const view = await readOwnPresence(stubMatrix({ presence: "unavailable" }));
        assert.deepEqual(view, { presence: "unavailable", statusMessage: null });
    });

    it("rejects without a session instead of inventing one", async () => {
        await assert.rejects(readOwnPresence(stubMatrix({ presence: "online" }, null)), /No session/);
    });

    it("propagates a server refusal (presence disabled)", async () => {
        await assert.rejects(readOwnPresence(stubMatrix(new Error("M_FORBIDDEN"))), /M_FORBIDDEN/);
    });
});

describe("fake ownPresence feed", () => {
    it("starts unknown so the UI shows its honest hint", () => {
        assert.equal(createFakeChatClient().ownPresence.get(), null);
    });

    it("publishes the written status and presence", async () => {
        const fake = createFakeChatClient();
        await fake.setOwnPresence("unavailable", "Listening to Kite");
        assert.deepEqual(fake.ownPresence.get(), {
            presence: "unavailable",
            statusMessage: "Listening to Kite",
        });
    });

    it("clears the status message when it is empty or omitted", async () => {
        const fake = createFakeChatClient();
        await fake.setOwnPresence("online", "Listening to Kite");
        await fake.setOwnPresence("online");
        assert.deepEqual(fake.ownPresence.get(), { presence: "online", statusMessage: null });
        await fake.setOwnPresence("online", "   ");
        assert.equal(fake.ownPresence.get()?.statusMessage, null);
    });
});
