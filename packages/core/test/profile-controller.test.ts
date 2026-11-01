import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { AuthStorage } from "../src/auth/storage.ts";
import type { ClientContext } from "../src/client-context.ts";
import { ProfileController } from "../src/rooms/profile-controller.ts";

function context(matrix: () => MatrixClient | null): ClientContext {
    const data = new Map<string, string>();
    return {
        storage: new AuthStorage({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        }),
        matrix,
        session: () => null,
        selectedRoomId: () => null,
    };
}

interface StubOptions {
    support?: () => Promise<boolean>;
    profile?: () => Promise<{ displayname?: string; avatar_url?: string }>;
    setDisplayName?: () => Promise<void>;
    field?: () => Promise<unknown>;
}

function stubMatrix(options: StubOptions = {}): MatrixClient & { supportChecks: number } {
    const matrix = {
        supportChecks: 0,
        getUserId: () => "@alice:example.com",
        doesServerSupportExtendedProfiles: () => {
            matrix.supportChecks += 1;
            return (options.support ?? (async () => true))();
        },
        getProfileInfo: options.profile ?? (async () => ({ displayname: "Alice", avatar_url: "mxc://x/y" })),
        setDisplayName: options.setDisplayName ?? (async () => undefined),
        getExtendedProfileProperty: options.field ?? (async () => "value"),
        setExtendedProfileProperty: async () => undefined,
        deleteExtendedProfileProperty: async () => undefined,
    };
    return matrix as unknown as MatrixClient & { supportChecks: number };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("ProfileController", () => {
    it("publishes the server's profile, or the localpart fallback when the read fails", async () => {
        const ok = new ProfileController(context(() => stubMatrix()));
        await ok.refresh();
        assert.deepEqual(ok.feed.get(), { userId: "@alice:example.com", displayName: "Alice", avatarUrl: "mxc://x/y" });

        const failing = new ProfileController(
            context(() =>
                stubMatrix({
                    profile: async () => {
                        throw new Error("offline");
                    },
                }),
            ),
        );
        await failing.refresh();
        assert.deepEqual(failing.feed.get(), { userId: "@alice:example.com", displayName: "alice", avatarUrl: null });
    });

    it("does nothing before start, and refuses writes with the contract's messages", async () => {
        const profile = new ProfileController(context(() => null));
        await profile.refresh();
        assert.equal(profile.feed.get(), null);
        assert.equal(await profile.fieldsSupported(), false);
        await assert.rejects(profile.set({ displayName: "x" }), /^Error: Cannot set profile before start\(\)$/);
        await assert.rejects(profile.setField("m.tz", "UTC"), /^Error: Cannot set a profile field before start\(\)$/);
    });

    it("refreshes before rethrowing a failed write, so the feed shows what the server holds", async () => {
        let reads = 0;
        const matrix = stubMatrix({
            setDisplayName: async () => {
                throw new Error("nope");
            },
            profile: async () => {
                reads += 1;
                return { displayname: "Server" };
            },
        });
        const profile = new ProfileController(context(() => matrix));
        await assert.rejects(profile.set({ displayName: "New" }), /nope/);
        assert.equal(reads, 1);
        assert.equal(profile.feed.get()?.displayName, "Server");
    });

    it("asks for MSC4133 support once per start, again after a transient failure and after resetForStop", async () => {
        let fail = true;
        const matrix = stubMatrix({
            support: async () => {
                if (fail) throw new Error("flaky");
                return true;
            },
        });
        const profile = new ProfileController(context(() => matrix));
        assert.equal(await profile.fieldsSupported(), false);
        fail = false;
        assert.equal(await profile.fieldsSupported(), true);
        assert.equal(await profile.fieldsSupported(), true);
        assert.equal(matrix.supportChecks, 2);
        profile.resetForStop();
        await profile.fieldsSupported();
        assert.equal(matrix.supportChecks, 3);
    });

    it("leaves a field stale (not null) while there is no client, and reads it once there is", async () => {
        let matrix: MatrixClient | null = null;
        const profile = new ProfileController(context(() => matrix));
        const feed = profile.field("@bob:example.com", "m.tz");
        const seen: unknown[] = [];
        const sub = feed.subscribe((value) => seen.push(value));
        await settle();
        assert.equal(seen.length, 0);
        sub.unsubscribe();

        matrix = stubMatrix({ field: async () => "Europe/London" });
        feed.subscribe((value) => seen.push(value));
        await settle();
        assert.deepEqual(seen, ["Europe/London"]);
    });

    it("reads an unset (404) field as null", async () => {
        const matrix = stubMatrix({
            field: async () => {
                throw Object.assign(new Error("not found"), { httpStatus: 404 });
            },
        });
        const profile = new ProfileController(context(() => matrix));
        const feed = profile.field("@bob:example.com", "m.tz");
        feed.subscribe(() => undefined);
        await settle();
        assert.equal(feed.get(), null);
    });
});
