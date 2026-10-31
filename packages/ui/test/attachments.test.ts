import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ALT_TEXT_KEY } from "@tumult/core/contract";
import {
    fileIcon,
    formatBytes,
    settleTray,
    toOutgoing,
    type StagedAttachment,
} from "../src/timeline/attachments.ts";
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

    it("fails the whole batch when the client threw (no per-file results)", () => {
        const items = [staged(1, "a.png", "image/png"), staged(2, "b.png", "image/png")];
        assert.deepEqual(settleTray(items, null).keep.map((i) => i.status), ["failed", "failed"]);
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
