import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { MediaResolver, parseMxc } from "../src/media/resolver.ts";
import { isTerminalMediaError } from "../src/media/classify.ts";
import { decryptAttachment } from "../src/media/attachment.ts";
import { sendMediaMessage } from "../src/rooms/media.ts";
import type { EncryptedAttachment } from "../src/contract.ts";

/** Unpadded base64 (standard alphabet) — matches the wire format. */
function toUnpaddedBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/=+$/, "");
}

/** Build a real AES-CTR encrypted attachment (MSC3846) plus its ciphertext. */
async function encryptFixture(plaintext: string) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const encryptKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, [
        "encrypt",
    ]);
    const jwk = await crypto.subtle.exportKey(
        "jwk",
        await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, true, [
            "encrypt",
            "decrypt",
        ]),
    );
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-CTR", counter: iv.buffer as ArrayBuffer, length: 64 },
        encryptKey,
        new TextEncoder().encode(plaintext),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
    const file: EncryptedAttachment = {
        url: "mxc://hs/abc",
        key: jwk as unknown as EncryptedAttachment["key"],
        iv: toUnpaddedBase64(iv),
        hashes: { sha256: toUnpaddedBase64(digest) },
        v: "v2",
    };
    return { file, ciphertext };
}

interface Call {
    path: string;
    query: Record<string, string> | undefined;
    opts: Record<string, unknown>;
}

function stub(opts: { v111?: boolean; fail?: number; error?: unknown; blob?: Blob } = {}) {
    const calls: Call[] = [];
    let failures = opts.fail ?? (opts.error ? Number.POSITIVE_INFINITY : 0);
    const matrix = {
        isVersionSupported: async (v: string) => v === "v1.11" && (opts.v111 ?? true),
        mxcUrlToHttp: (uri: string, w: number) => `https://legacy/${uri.slice(6)}?w=${w}`,
        http: {
            authedRequest: async (_m: string, path: string, query: Record<string, string>, _b: unknown, o: Record<string, unknown>) => {
                calls.push({ path, query, opts: o });
                if (failures-- > 0) throw opts.error ?? new Error("boom");
                return opts.blob ?? new Blob(["png"], { type: "image/png" });
            },
        },
    } as unknown as MatrixClient;
    return { matrix, calls };
}

describe("MediaResolver", () => {
    it("parses mxc URIs and rejects malformed ones", () => {
        assert.deepEqual(parseMxc("mxc://example.org/abc123"), { server: "example.org", mediaId: "abc123" });
        assert.equal(parseMxc("mxc://example.org/"), null);
        assert.equal(parseMxc("https://x/y"), null);
    });

    it("passes non-mxc URLs straight through", async () => {
        assert.equal(await new MediaResolver(stub().matrix).resolve("https://x/a.png", 48), "https://x/a.png");
    });

    it("fetches through the authenticated v1 endpoint as a blob URL, once per size", async () => {
        const { matrix, calls } = stub();
        const resolver = new MediaResolver(matrix);
        const [a, b] = await Promise.all([resolver.resolve("mxc://hs/id", 96), resolver.resolve("mxc://hs/id", 96)]);
        assert.ok(a.startsWith("blob:"));
        assert.equal(a, b);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.path, "/thumbnail/hs/id");
        assert.equal(calls[0]?.opts["prefix"], "/_matrix/client/v1/media");
        assert.equal(calls[0]?.opts["rawResponseBody"], true);
        assert.deepEqual(calls[0]?.query, { width: "96", height: "96", method: "scale" });
        resolver.dispose();
    });

    it("falls back to the legacy URL on servers without v1.11", async () => {
        const { matrix, calls } = stub({ v111: false });
        assert.equal(await new MediaResolver(matrix).resolve("mxc://hs/id", 48), "https://legacy/hs/id?w=48");
        assert.equal(calls.length, 0);
    });

    it("evicts failures so a later render retries", async () => {
        const { matrix, calls } = stub({ fail: 1 });
        const resolver = new MediaResolver(matrix);
        await assert.rejects(resolver.resolve("mxc://hs/id", 48));
        assert.ok((await resolver.resolve("mxc://hs/id", 48)).startsWith("blob:"));
        assert.equal(calls.length, 2);
        resolver.dispose();
    });

    it("caps thumbnail size", async () => {
        const { matrix, calls } = stub();
        const resolver = new MediaResolver(matrix);
        await resolver.resolve("mxc://hs/id", 10_000);
        assert.equal(calls[0]?.query["width"], "1024");
        resolver.dispose();
    });

    it("downloads full media through /download, not the image pipeline", async () => {
        const { matrix, calls } = stub();
        const resolver = new MediaResolver(matrix);
        const url = await resolver.resolveDownload("mxc://hs/clip");
        assert.ok(url.startsWith("blob:"));
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.path, "/download/hs/clip");
        assert.equal(calls[0]?.opts["prefix"], "/_matrix/client/v1/media");
        assert.equal(calls[0]?.opts["rawResponseBody"], true);
        // No width/height: /download is not the thumbnailer.
        assert.equal(calls[0]?.query, undefined);
        resolver.dispose();
    });

    it("passes non-mxc URLs straight through for downloads", async () => {
        const { matrix, calls } = stub();
        assert.equal(await new MediaResolver(matrix).resolveDownload("https://x/a.mp4"), "https://x/a.mp4");
        assert.equal(calls.length, 0);
    });

    it("decrypts an encrypted attachment fetched from /download", async () => {
        const { file, ciphertext } = await encryptFixture("secret bytes");
        const { matrix, calls } = stub({ blob: new Blob([ciphertext]) });
        const resolver = new MediaResolver(matrix);
        const url = await resolver.resolveEncrypted(file);
        assert.ok(url.startsWith("blob:"));
        assert.equal(calls[0]?.path, "/download/hs/abc");
        assert.equal(await (await fetch(url)).text(), "secret bytes");
        resolver.dispose();
    });

    it("remembers terminal failures instead of re-fetching them", async () => {
        const notFound = Object.assign(new Error("Not found"), {
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });
        const { matrix, calls } = stub({ error: notFound });
        const resolver = new MediaResolver(matrix);
        await assert.rejects(resolver.resolve("mxc://hs/gone", 48));
        await assert.rejects(resolver.resolve("mxc://hs/gone", 48));
        assert.equal(calls.length, 1, "the second render must not touch the network");
        resolver.dispose();
    });

    it("keeps transient failures retryable", async () => {
        const { matrix, calls } = stub({ fail: 2, error: Object.assign(new Error("boom"), { httpStatus: 503 }) });
        const resolver = new MediaResolver(matrix);
        await assert.rejects(resolver.resolve("mxc://hs/id", 48));
        await assert.rejects(resolver.resolve("mxc://hs/id", 48));
        assert.ok((await resolver.resolve("mxc://hs/id", 48)).startsWith("blob:"));
        assert.equal(calls.length, 3);
        resolver.dispose();
    });

    it("forgets terminal failures on dispose, so a restart retries", async () => {
        const notFound = Object.assign(new Error("Not found"), { httpStatus: 404 });
        const { matrix, calls } = stub({ error: notFound });
        const resolver = new MediaResolver(matrix);
        await assert.rejects(resolver.resolve("mxc://hs/gone", 48));
        assert.equal(calls.length, 1);

        resolver.dispose();
        await assert.rejects(resolver.resolve("mxc://hs/gone", 48));
        assert.equal(calls.length, 2, "a fresh client must be free to try again");
    });
});

describe("isTerminalMediaError", () => {
    it("treats a server verdict (4xx) as terminal", () => {
        for (const httpStatus of [400, 403, 404, 410]) {
            assert.equal(isTerminalMediaError({ httpStatus }), true, `status ${httpStatus}`);
        }
    });

    it("keeps transient failures retryable", () => {
        assert.equal(isTerminalMediaError({ httpStatus: 500 }), false);
        assert.equal(isTerminalMediaError({ httpStatus: 408 }), false, "timeout");
        assert.equal(isTerminalMediaError({ httpStatus: 429 }), false, "rate limited");
        assert.equal(isTerminalMediaError(new Error("network down")), false);
        assert.equal(isTerminalMediaError(undefined), false);
        assert.equal(isTerminalMediaError(null), false);
    });
});

describe("sendMediaMessage", () => {
    function stubMatrix() {
        const calls: unknown[][] = [];
        const matrix = {
            uploadContent: async (file: File | Blob) => {
                calls.push(["upload", file]);
                return { content_uri: "mxc://hs/uploaded" };
            },
            sendMessage: async (...args: unknown[]) => {
                calls.push(["send", ...args]);
                return { event_id: "$sent:x" };
            },
        } as unknown as MatrixClient;
        return { matrix, calls };
    }

    it("uploads then sends an image message", async () => {
        const { matrix, calls } = stubMatrix();
        const file = new File(["png"], "photo.png", { type: "image/png" });
        await sendMediaMessage(matrix, "!r:x", file);
        assert.equal(calls.length, 2);
        assert.equal(calls[0]?.[0], "upload");
        const send = calls[1] as [string, string, Record<string, unknown>];
        assert.equal(send[1], "!r:x");
        assert.deepEqual(send[2], {
            msgtype: "m.image",
            body: "photo.png",
            url: "mxc://hs/uploaded",
            info: { mimetype: "image/png", size: 3 },
        });
    });

    it("uses the provided caption as body", async () => {
        const { matrix, calls } = stubMatrix();
        const file = new File(["png"], "photo.png", { type: "image/png" });
        await sendMediaMessage(matrix, "!r:x", file, "look at this");
        const send = calls[1] as [string, string, Record<string, unknown>];
        assert.equal(send[2]?.["body"], "look at this");
    });

    it("maps video, audio and generic files to the right msgtype", async () => {
        const { matrix, calls } = stubMatrix();
        await sendMediaMessage(matrix, "!r:x", new File(["v"], "clip.mp4", { type: "video/mp4" }));
        await sendMediaMessage(matrix, "!r:x", new File(["a"], "song.mp3", { type: "audio/mpeg" }));
        await sendMediaMessage(matrix, "!r:x", new File(["d"], "doc.pdf", { type: "application/pdf" }));
        const sends = calls.filter((c) => c[0] === "send") as [string, string, Record<string, unknown>][];
        assert.equal(sends[0]?.[2]?.["msgtype"], "m.video");
        assert.equal(sends[1]?.[2]?.["msgtype"], "m.audio");
        assert.equal(sends[2]?.[2]?.["msgtype"], "m.file");
    });

    it("handles Blob (no filename) with a default name", async () => {
        const { matrix, calls } = stubMatrix();
        const blob = new Blob(["data"], { type: "image/png" });
        await sendMediaMessage(matrix, "!r:x", blob);
        const send = calls[1] as [string, string, Record<string, unknown>];
        assert.equal(send[2]?.["body"], "file");
        assert.equal(send[2]?.["msgtype"], "m.image");
    });

    it("propagates upload failures", async () => {
        const matrix = {
            uploadContent: async () => {
                throw new Error("M_TOO_LARGE");
            },
        } as unknown as MatrixClient;
        await assert.rejects(
            () => sendMediaMessage(matrix, "!r:x", new File(["x"], "big.png", { type: "image/png" })),
            /M_TOO_LARGE/,
        );
    });

    it("propagates send failures", async () => {
        const matrix = {
            uploadContent: async () => ({ content_uri: "mxc://hs/x" }),
            sendMessage: async () => {
                throw new Error("M_FORBIDDEN");
            },
        } as unknown as MatrixClient;
        await assert.rejects(
            () => sendMediaMessage(matrix, "!r:x", new File(["x"], "a.png", { type: "image/png" })),
            /M_FORBIDDEN/,
        );
    });
});

describe("decryptAttachment", () => {
    it("decrypts ciphertext and verifies an unpadded base64 hash", async () => {
        const { file, ciphertext } = await encryptFixture("hello attachment");
        const plaintext = await decryptAttachment(file, ciphertext);
        assert.equal(new TextDecoder().decode(plaintext), "hello attachment");
    });

    it("accepts url-safe base64 hashes too", async () => {
        const { file, ciphertext } = await encryptFixture("url safe");
        // Convert the standard-alphabet hash to url-safe (may swap +/ chars).
        file.hashes["sha256"] = file.hashes["sha256"]!.replace(/\+/g, "-").replace(/\//g, "_");
        const plaintext = await decryptAttachment(file, ciphertext);
        assert.equal(new TextDecoder().decode(plaintext), "url safe");
    });

    it("rejects when the ciphertext hash does not match", async () => {
        const { file, ciphertext } = await encryptFixture("tampered");
        file.hashes["sha256"] = toUnpaddedBase64(new Uint8Array(32).fill(0));
        await assert.rejects(() => decryptAttachment(file, ciphertext), /hash mismatch/);
    });

    it("decrypts without a hash when hashes is empty", async () => {
        const { file, ciphertext } = await encryptFixture("no hash");
        file.hashes = {};
        const plaintext = await decryptAttachment(file, ciphertext);
        assert.equal(new TextDecoder().decode(plaintext), "no hash");
    });
});
