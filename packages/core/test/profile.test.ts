import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { fallbackName, readProfile, writeProfile } from "../src/rooms/profile.ts";

interface ProfileCalls {
    displayNames: string[];
    avatarUrls: string[];
    uploads: Blob[];
}

function stubMatrix(
    info: { displayname?: string; avatar_url?: string } | Error,
    userId: string | null = "@alice:example.com",
): MatrixClient & ProfileCalls {
    const calls: ProfileCalls = { displayNames: [], avatarUrls: [], uploads: [] };
    const matrix = {
        getUserId: () => userId,
        getProfileInfo: async () => {
            if (info instanceof Error) throw info;
            return info;
        },
        setDisplayName: async (name: string) => {
            calls.displayNames.push(name);
            return {};
        },
        setAvatarUrl: async (url: string) => {
            calls.avatarUrls.push(url);
            return {};
        },
        uploadContent: async (file: Blob) => {
            calls.uploads.push(file);
            return { content_uri: "mxc://example.com/uploaded" };
        },
        ...calls,
    };
    return matrix as unknown as MatrixClient & ProfileCalls;
}

describe("fallbackName", () => {
    it("prefers a real display name, falls back to the localpart", () => {
        assert.equal(fallbackName("@alice:example.com", "Alice"), "Alice");
        assert.equal(fallbackName("@alice:example.com"), "alice");
        assert.equal(fallbackName("@alice:example.com", "@alice:example.com"), "alice");
        assert.equal(fallbackName("not-an-mxid"), "not-an-mxid");
    });
});

describe("readProfile", () => {
    it("maps the profile endpoint onto ProfileView", async () => {
        const view = await readProfile(stubMatrix({ displayname: "Alice", avatar_url: "mxc://example.com/a" }));
        assert.deepEqual(view, {
            userId: "@alice:example.com",
            displayName: "Alice",
            avatarUrl: "mxc://example.com/a",
        });
    });

    it("falls back to the localpart while unnamed", async () => {
        const view = await readProfile(stubMatrix({}));
        assert.equal(view.displayName, "alice");
        assert.equal(view.avatarUrl, null);
    });

    it("rejects without a session and propagates server failures", async () => {
        await assert.rejects(readProfile(stubMatrix({}, null)), /No session/);
        await assert.rejects(readProfile(stubMatrix(new Error("503 upstream"), "@alice:example.com")), /503/);
    });
});

describe("writeProfile", () => {
    it("trims a display name and sends only what was asked for", async () => {
        const matrix = stubMatrix({});
        await writeProfile(matrix, { displayName: "  Alicia  " });
        assert.deepEqual(matrix.displayNames, ["Alicia"]);
        assert.deepEqual(matrix.avatarUrls, []);
        assert.equal(matrix.uploads.length, 0);
    });

    it("uploads an avatar first, then points the profile at it", async () => {
        const matrix = stubMatrix({});
        const blob = new Blob(["png"], { type: "image/png" });
        await writeProfile(matrix, { avatar: blob });
        assert.deepEqual(matrix.avatarUrls, ["mxc://example.com/uploaded"]);
        assert.deepEqual(matrix.uploads, [blob]);
        assert.deepEqual(matrix.displayNames, []);
    });

    it("clears an avatar on null, and does nothing for empty params", async () => {
        const matrix = stubMatrix({});
        await writeProfile(matrix, { avatar: null });
        assert.deepEqual(matrix.avatarUrls, [""]);

        const untouched = stubMatrix({});
        await writeProfile(untouched, {});
        assert.deepEqual(untouched.displayNames, []);
        assert.deepEqual(untouched.avatarUrls, []);
        assert.equal(untouched.uploads.length, 0);
    });
});
