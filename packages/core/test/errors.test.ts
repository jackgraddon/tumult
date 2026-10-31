import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ConnectionError, HTTPError, MatrixError } from "matrix-js-sdk";

import { describeError, formatBytes, isAbort, isHuman, reportError } from "../src/errors.ts";

const URL = "https://matrix.example.org/_matrix/client/v3/rooms/!r:example.org/ban";

function matrix(errcode: string, status: number, extra: Record<string, unknown> = {}): MatrixError {
    return new MatrixError({ errcode, error: "Server words.", ...extra }, status, URL);
}

/** No sentence may leak what the translator exists to hide. */
function assertClean(sentence: string): void {
    assert.doesNotMatch(sentence, /https?:\/\//, sentence);
    assert.doesNotMatch(sentence, /\bM_[A-Z_]+/, sentence);
    assert.doesNotMatch(sentence, /MatrixError|\[\d{3}\]|Failed to fetch/, sentence);
}

describe("describeError", () => {
    const cases: [string, unknown, RegExp][] = [
        ["M_FORBIDDEN", matrix("M_FORBIDDEN", 403), /^Couldn't ban Bob: you don't have permission/],
        ["M_LIMIT_EXCEEDED with retry_after_ms", matrix("M_LIMIT_EXCEEDED", 429, { retry_after_ms: 2500 }), /too often\. Try again in 3 seconds\.$/],
        ["M_LIMIT_EXCEEDED without a delay", matrix("M_LIMIT_EXCEEDED", 429), /too often\. Wait a moment/],
        ["M_TOO_LARGE", matrix("M_TOO_LARGE", 413), /too large for your homeserver/],
        ["M_NOT_FOUND", matrix("M_NOT_FOUND", 404), /couldn't be found/],
        ["M_UNKNOWN_TOKEN", matrix("M_UNKNOWN_TOKEN", 401), /session has expired/],
        ["M_MISSING_TOKEN", matrix("M_MISSING_TOKEN", 401), /session has expired/],
        ["M_USER_IN_USE", matrix("M_USER_IN_USE", 400), /username is already taken/],
        ["M_ROOM_IN_USE", matrix("M_ROOM_IN_USE", 400), /room address is already in use/],
        ["M_INVALID_PARAM keeps short server text", matrix("M_INVALID_PARAM", 400), /rejected the request as invalid \(“Server words”\)\.$/],
        ["M_UNRECOGNIZED", matrix("M_UNRECOGNIZED", 404), /homeserver doesn't support this/],
        ["M_GUEST_ACCESS_FORBIDDEN", matrix("M_GUEST_ACCESS_FORBIDDEN", 403), /guests can't/],
        ["M_RESOURCE_LIMIT_EXCEEDED", matrix("M_RESOURCE_LIMIT_EXCEEDED", 403), /usage limit/],
        ["M_UNSUPPORTED_ROOM_VERSION", matrix("M_UNSUPPORTED_ROOM_VERSION", 400), /room's version/],
        ["M_USER_DEACTIVATED", matrix("M_USER_DEACTIVATED", 403), /deactivated/],
        ["unknown errcode falls back to status", matrix("M_SOMETHING_NEW", 503), /unreachable or overloaded/],
        ["HTTP 401", new HTTPError("raw 401 " + URL, 401), /session has expired/],
        ["HTTP 403", new HTTPError("raw", 403), /permission/],
        ["HTTP 404", new HTTPError("raw", 404), /couldn't be found/],
        ["HTTP 408", new HTTPError("raw", 408), /took too long/],
        ["HTTP 413", new HTTPError("raw", 413), /too large/],
        ["HTTP 429", new HTTPError("raw", 429), /too often/],
        ["HTTP 500", new HTTPError("raw", 500), /ran into a problem/],
        ["HTTP 502", new HTTPError("raw", 502), /unreachable or overloaded/],
        ["HTTP 504", new HTTPError("raw", 504), /unreachable or overloaded/],
        ["other 4xx", new HTTPError("raw", 418), /something went wrong\. Try again/],
        ["ConnectionError", new ConnectionError("fetch failed", new TypeError("Failed to fetch")), /couldn't reach the server/],
        ["fetch TypeError (Chromium)", new TypeError("Failed to fetch"), /couldn't reach the server/],
        ["fetch TypeError (Firefox/CORS)", new TypeError("NetworkError when attempting to fetch resource."), /couldn't reach the server/],
        ["TimeoutError", Object.assign(new Error("signal timed out"), { name: "TimeoutError" }), /took too long/],
        ["a raw dump", new Error('{"errcode":"X"} at foo.ts:12'), /something went wrong/],
        ["a programming TypeError", new TypeError("Cannot read properties of undefined (reading 'x')"), /something went wrong/],
    ];
    for (const [name, error, expected] of cases) {
        it(`translates ${name}`, () => {
            const sentence = describeError(error, "Couldn't ban Bob");
            assert.match(sentence, expected);
            assert.match(sentence, /^Couldn't ban Bob: /);
            assertClean(sentence);
        });
    }

    it("finds the Matrix error however deep the SDK nested it", () => {
        const deep = new Error("outer: M_FORBIDDEN: MatrixError: [403] (" + URL + ")", { cause: new Error("mid", { cause: matrix("M_FORBIDDEN", 403) }) });
        assert.match(describeError(deep, "Couldn't join"), /permission/);
    });

    it("reads Retry-After from the headers when the body has no delay", () => {
        const headers = new Headers({ "Retry-After": "7" });
        const error = new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429, URL, undefined, headers);
        assert.match(describeError(error), /Try again in 7 seconds\.$/);
    });

    it("names the upload limit when the caller knows it", () => {
        assert.match(describeError(matrix("M_TOO_LARGE", 413), "Couldn't upload a.png", { maxUploadBytes: 50 * 1024 * 1024 }), /accepts files up to 50 MB\.$/);
    });

    it("drops server text that is not human (codes, URLs)", () => {
        const error = new MatrixError({ errcode: "M_INVALID_PARAM", error: "M_INVALID_PARAM: see " + URL }, 400, URL);
        const sentence = describeError(error);
        assert.equal(sentence, "The homeserver rejected the request as invalid. Try again in a moment.");
    });

    it("keeps our own sentences, capitalised when standalone", () => {
        assert.equal(describeError(new Error("Pick who you want to invite.")), "Pick who you want to invite.");
        assert.equal(describeError(new Error("The bundle is too big."), "Couldn't install"), "Couldn't install: the bundle is too big.");
        assert.equal(describeError("plain words"), "Plain words");
    });

    it("keeps the app's own diagnostics verbatim only when asked", () => {
        const own = new Error("Invalid clientUri \"http://localhost\": must be https");
        assert.equal(describeError(own, "Couldn't sign in", { verbatimOwn: true }), own.message);
        assert.match(describeError(own, "Couldn't sign in"), /something went wrong/);
        assert.match(describeError(matrix("M_FORBIDDEN", 403), "Couldn't sign in", { verbatimOwn: true }), /permission/);
    });

    it("reports an offline browser distinctly", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
        try {
            assert.match(describeError(new TypeError("Failed to fetch")), /^You appear to be offline/);
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
        }
    });

    it("says nothing for an abort", () => {
        const abort = new DOMException("The operation was aborted.", "AbortError");
        assert.equal(describeError(abort, "Couldn't search"), "");
        assert.equal(describeError(new Error("wrapped", { cause: abort })), "");
        assert.ok(isAbort(abort));
    });

    it("calms a value that is not an error at all", () => {
        assert.equal(describeError(undefined), "Something went wrong. Try again in a moment.");
        assert.equal(describeError({ weird: true }, "Couldn't save"), "Couldn't save: something went wrong. Try again in a moment.");
    });
});

describe("reportError", () => {
    const original = console.error;
    afterEach(() => {
        console.error = original;
    });

    it("logs the raw error with its context and returns the sentence", () => {
        const logged: unknown[][] = [];
        console.error = (...args: unknown[]) => void logged.push(args);
        const error = matrix("M_FORBIDDEN", 403);
        assert.match(reportError(error, "Couldn't kick Bob"), /^Couldn't kick Bob: you don't have permission/);
        assert.deepEqual(logged, [["[tumult] Couldn't kick Bob", error]]);
    });
});

describe("helpers", () => {
    it("formats byte sizes", () => {
        assert.equal(formatBytes(512), "512 bytes");
        assert.equal(formatBytes(1536), "1.5 KB");
        assert.equal(formatBytes(100 * 1024 * 1024), "100 MB");
    });

    it("tells human text from dumps", () => {
        assert.ok(isHuman("Room name is too long"));
        assert.ok(!isHuman("MatrixError: [403] nope (" + URL + ")"));
        assert.ok(!isHuman('{"error":"x"}'));
        assert.ok(!isHuman("M_FORBIDDEN"));
    });
});
