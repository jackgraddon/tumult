import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTokenRefreshError, uploadWithRefresh } from "../src/util/token-refresh.ts";
import type { MatrixClient } from "matrix-js-sdk";

/** A `M_UNKNOWN_TOKEN` 401 as the homeserver stamps it. */
const unknownToken = Object.assign(new Error("M_UNKNOWN_TOKEN"), {
    errcode: "M_UNKNOWN_TOKEN",
    httpStatus: 401,
});

describe("isTokenRefreshError", () => {
    it("recognises a dead access token (401 + M_UNKNOWN_TOKEN)", () => {
        assert.equal(isTokenRefreshError(unknownToken), true);
    });

    it("accepts the same errcode without an httpStatus (XHR sometimes omits it)", () => {
        assert.equal(isTokenRefreshError({ errcode: "M_UNKNOWN_TOKEN" }), true);
    });

    it("rejects a wrong-errcode 401 and non-refreshable 4xx/5xx", () => {
        assert.equal(isTokenRefreshError({ errcode: "M_FORBIDDEN", httpStatus: 403 }), false);
        assert.equal(isTokenRefreshError({ errcode: "M_TOO_LARGE", httpStatus: 413 }), false);
        assert.equal(isTokenRefreshError({ errcode: "M_NOT_FOUND", httpStatus: 404 }), false);
        assert.equal(isTokenRefreshError({ errcode: "M_UNKNOWN", httpStatus: 500 }), false);
    });

    it("rejects the nullish / non-object cases", () => {
        assert.equal(isTokenRefreshError(null), false);
        assert.equal(isTokenRefreshError(undefined), false);
        assert.equal(isTokenRefreshError("M_UNKNOWN_TOKEN"), false);
        assert.equal(isTokenRefreshError(new Error("network down")), false);
    });
});

describe("uploadWithRefresh", () => {
    it("uploads straight through when the first upload succeeds", async () => {
        let refreshes = 0;
        const uploadContent = async () => ({ content_uri: "mxc://hs/x" });
        const refreshToken = async () => {
            refreshes += 1;
            return { access_token: "live" };
        };
        const matrix = { uploadContent, getRefreshToken: () => "rt", refreshToken } as unknown as MatrixClient;
        const res = await uploadWithRefresh(matrix, new Blob(["x"]));
        assert.equal(res.content_uri, "mxc://hs/x");
        assert.equal(refreshes, 0);
    });

    it("forces one MAS refresh then retries once after a M_UNKNOWN_TOKEN", async () => {
        let attempts = 0;
        let refreshes = 0;
        const refreshToken = async (rt: string) => {
            refreshes += 1;
            assert.equal(rt, "rotated-rt-1");
            return { access_token: "live-2" };
        };
        const uploadContent = async () => {
            attempts += 1;
            if (attempts === 1) throw unknownToken;
            return { content_uri: "mxc://hs/retrying" };
        };
        const matrix = { getRefreshToken: () => "rotated-rt-1", refreshToken, uploadContent } as unknown as MatrixClient;
        const res = await uploadWithRefresh(matrix, new Blob(["x"]));
        assert.equal(res.content_uri, "mxc://hs/retrying");
        assert.equal(refreshes, 1);
        assert.equal(attempts, 2);
    });

    it("propagates once if the retry still fails with M_UNKNOWN_TOKEN", async () => {
        let attempts = 0;
        let refreshes = 0;
        const refreshToken = async () => {
            refreshes += 1;
            return { access_token: "live-2" };
        };
        const uploadContent = async () => {
            attempts += 1;
            throw unknownToken;
        };
        const matrix = { getRefreshToken: () => "rt", refreshToken, uploadContent } as unknown as MatrixClient;
        await assert.rejects(
            () => uploadWithRefresh(matrix, new Blob(["x"])),
            unknownToken,
        );
        assert.equal(refreshes, 1);
        assert.equal(attempts, 2);
    });

    it("propagates the original error when there is no refresh token to recover with", async () => {
        let refreshes = 0;
        const refreshToken = async () => {
            refreshes += 1;
            return { access_token: "live" };
        };
        const uploadContent = async () => {
            throw unknownToken;
        };
        const matrix = { getRefreshToken: () => null, refreshToken, uploadContent } as unknown as MatrixClient;
        await assert.rejects(
            () => uploadWithRefresh(matrix, new Blob(["x"])),
            unknownToken,
        );
        assert.equal(refreshes, 0);
    });

    it("does not retry a genuine server error (does not hit the refresh path)", async () => {
        let refreshes = 0;
        let attempts = 0;
        const toobig = Object.assign(new Error("M_TOO_LARGE"), {
            errcode: "M_TOO_LARGE",
            httpStatus: 413,
        });
        const refreshToken = async () => {
            refreshes += 1;
            return { access_token: "live" };
        };
        const uploadContent = async () => {
            attempts += 1;
            throw toobig;
        };
        const matrix = { getRefreshToken: () => "rt", refreshToken, uploadContent } as unknown as MatrixClient;
        await assert.rejects(
            () => uploadWithRefresh(matrix, new Blob(["x"])),
            toobig,
        );
        assert.equal(refreshes, 0, "no refresh on a non-refreshable error");
        assert.equal(attempts, 1, "and exactly one upload attempt");
    });
});
