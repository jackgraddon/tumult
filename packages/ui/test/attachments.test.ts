import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ALT_TEXT_KEY } from "@tumult/core/contract";
import {
    applyUploadLimit,
    fileIcon,
    formatBytes,
    settleTray,
    toOutgoing,
    type StagedAttachment,
} from "../src/timeline/attachments.ts";
import { jpegName, looksHeic } from "../src/timeline/heic.ts";
import { mediaText } from "../src/timeline/renderers/mediaText.ts";

function staged(id: number, name: string, type: string, altText = ""): StagedAttachment {
    return { id, file: new File(["x"], name, { type }), previewUrl: null, altText, status: "staged" };
}

describe("attachment tray helpers", () => {
    it("formats sizes", () => {
        assert.equal(formatBytes(0), "0 B");
        assert.equal(formatBytes(1536), "1.5 KB");
        assert.equal(formatBytes(20 * 1024 * 1024), "20 MB");
    });

    it("picks a chip icon by type", () => {
        assert.equal(fileIcon(new Blob([], { type: "application/pdf" })), "file-document-outline");
        assert.equal(fileIcon(new Blob([], { type: "audio/ogg" })), "file-music-outline");
        assert.equal(fileIcon(new Blob([], { type: "application/zip" })), "file-outline");
    });

    it("sends trimmed alt text for images only, and dims when measured", () => {
        const image = { ...staged(1, "a.png", "image/png", "  a cat  "), width: 4, height: 3 };
        const pdf = staged(2, "b.pdf", "application/pdf", "ignored");
        const blank = staged(3, "c.png", "image/png", "   ");
        const out = toOutgoing([image, pdf, blank]);
        assert.deepEqual(out.map((o) => [o.altText, o.width, o.height]), [
            ["a cat", 4, 3],
            [undefined, undefined, undefined],
            [undefined, undefined, undefined],
        ]);
    });

    it("drops landed files and keeps failed ones marked failed", () => {
        const items = [staged(1, "a.png", "image/png"), staged(2, "b.png", "image/png")];
        const { keep, sent } = settleTray(items, [{ ok: true }, { ok: false, error: new Error("x") }]);
        assert.deepEqual(sent.map((i) => i.id), [1]);
        assert.deepEqual(keep.map((i) => [i.id, i.status]), [[2, "failed"]]);
    });

    it("says WHY a file did not land, as a sentence — no URL, no errcode", () => {
        const items = [staged(1, "a.png", "image/png"), staged(2, "huge.mov", "video/quicktime")];
        // The shape a MatrixError has (and what describeError reads): the SDK's
        // own message embeds the request URL, which must never reach the card.
        const tooLarge = Object.assign(new Error("MatrixError: [413] M_TOO_LARGE (https://hs.example/_matrix/media/v3/upload)"), {
            name: "MatrixError",
            errcode: "M_TOO_LARGE",
            httpStatus: 413,
            data: { errcode: "M_TOO_LARGE", error: "Upload request body is too large" },
        });
        const { keep } = settleTray(items, [{ ok: true }, { ok: false, error: tooLarge }], undefined, 50 * 1024 * 1024);
        const failure = keep[0]?.failure ?? "";
        assert.ok(failure.length > 0, "a failed file carries its reason");
        assert.doesNotMatch(failure, /https?:|_matrix|M_[A-Z]/, failure);
        assert.match(failure, /large|50/i, failure);
    });

    it("fails the whole batch when the client threw (no per-file results)", () => {
        const items = [staged(1, "a.png", "image/png"), staged(2, "b.png", "image/png")];
        assert.deepEqual(settleTray(items, null).keep.map((i) => i.status), ["failed", "failed"]);
        const offline = Object.assign(new Error("fetch failed: Failed to fetch"), { name: "ConnectionError" });
        const reasons = settleTray(items, null, offline).keep.map((i) => i.failure);
        assert.equal(reasons[0], reasons[1], "one throw, one reason for every file");
        assert.doesNotMatch(reasons[0] ?? "", /Failed to fetch/, "the raw fetch error never reaches the card");
    });
});

describe("applyUploadLimit", () => {
    const big = (status: StagedAttachment["status"]): StagedAttachment => ({
        ...staged(1, "big.png", "image/png"),
        file: new File([new Uint8Array(100)], "big.png", { type: "image/png" }),
        status,
    });

    it("marks settled files over the limit too-large, and lifts it when the limit allows", () => {
        assert.equal(applyUploadLimit([big("staged")], 50)[0]?.status, "too-large");
        assert.equal(applyUploadLimit([big("failed")], 50)[0]?.status, "too-large");
        assert.equal(applyUploadLimit([big("too-large")], 500)[0]?.status, "staged");
    });

    it("leaves converting/sending files alone and treats an unknown limit as no limit", () => {
        assert.equal(applyUploadLimit([big("converting")], 50)[0]?.status, "converting");
        assert.equal(applyUploadLimit([big("sending")], 50)[0]?.status, "sending");
        assert.equal(applyUploadLimit([big("staged")], null)[0]?.status, "staged");
    });

    it("returns the same objects when nothing changes", () => {
        const items = [big("staged")];
        assert.equal(applyUploadLimit(items, 500)[0], items[0]);
    });
});

describe("HEIC detection", () => {
    it("matches by type, or by extension only when the type is missing", () => {
        assert.equal(looksHeic(new File([], "a.HEIC", { type: "image/heic" })), true);
        assert.equal(looksHeic(new File([], "a.heif", { type: "" })), true);
        assert.equal(looksHeic(new File([], "a.heic", { type: "application/octet-stream" })), true);
        assert.equal(looksHeic(new File([], "a.heic", { type: "image/png" })), false);
        assert.equal(looksHeic(new File([], "a.png", { type: "image/png" })), false);
    });

    it("renames to .jpg", () => {
        assert.equal(jpegName("IMG_3947.HEIC"), "IMG_3947.jpg");
        assert.equal(jpegName("photo"), "photo.jpg");
    });
});

describe("mediaText", () => {
    it("reads a differing body as the MSC2530 caption", () => {
        const text = mediaText({ filename: "cat.png", body: "look" }, "look");
        assert.deepEqual(text, { name: "cat.png", caption: "look", alt: "look" });
    });

    it("treats body == filename, or no filename, as no caption", () => {
        assert.equal(mediaText({ filename: "cat.png" }, "cat.png").caption, null);
        assert.deepEqual(mediaText({}, "legacy.png"), { name: "legacy.png", caption: null, alt: "legacy.png" });
    });

    it("prefers namespaced alt text for the accessible description", () => {
        const text = mediaText({ filename: "cat.png", [ALT_TEXT_KEY]: "a grey cat" }, "cat.png");
        assert.equal(text.alt, "a grey cat");
        assert.equal(text.caption, null);
    });
});
