import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findExternalStylesheetReferences } from "../src/plugins/styles.ts";

/**
 * The DOM half of `injectStylesheet` (append a `<style>`, remove it on dispose)
 * is verified in the browser smoke test, where a real document exists. What is
 * checked here is the guard, which is what keeps a plugin stylesheet from
 * turning into a third-party request.
 */
describe("findExternalStylesheetReferences", () => {
    it("accepts a self-contained stylesheet", () => {
        const css = `
.tumult-poll {
    margin: 0;
    padding: var(--space-2);
    background: var(--surface-pane);
    border-radius: var(--control-radius);
}
`;
        assert.deepEqual(findExternalStylesheetReferences(css), []);
    });

    it("accepts inline data:, app-minted blob: and same-document fragments", () => {
        const css = `
.icon { background-image: url("data:image/svg+xml;base64,AAA"); }
.clip { clip-path: url(#clip); }
.thumb { background-image: url(blob:http://localhost/uuid); }
`;
        assert.deepEqual(findExternalStylesheetReferences(css), []);
    });

    it("rejects every @import form", () => {
        assert.deepEqual(findExternalStylesheetReferences('@import "other.css";'), [
            '@import "other.css";',
        ]);
        assert.deepEqual(findExternalStylesheetReferences("@import url(theme.css);"), [
            "@import url(theme.css);",
        ]);
        assert.equal(findExternalStylesheetReferences("@import url(https://evil.example/x.css);").length, 1);
    });

    it("rejects remote, protocol-relative and same-origin url() references", () => {
        for (const target of [
            "https://evil.example/track.png",
            "http://evil.example/track.png",
            "//evil.example/track.png",
            "/assets/logo.png",
            "logo.png",
        ]) {
            const css = `.x { background-image: url(${target}); }`;
            assert.deepEqual(
                findExternalStylesheetReferences(css),
                [`url(${target})`],
                target,
            );
        }
    });

    it("reports every offending declaration, quoted or not", () => {
        const css = `
@import url(https://a.example/a.css);
.a { background: url('https://b.example/b.png'); cursor: url(cursors/pointer.cur), auto; }
.b { background: url("data:image/png;base64,AAA"); }
`;
        assert.deepEqual(findExternalStylesheetReferences(css), [
            "@import url(https://a.example/a.css);",
            "url('https://b.example/b.png')",
            "url(cursors/pointer.cur)",
        ]);
    });

    it("collapses whitespace in the reported snippet", () => {
        assert.deepEqual(findExternalStylesheetReferences(".x { background: url(\n    https://a.example/x.png\n); }"), [
            "url( https://a.example/x.png )",
        ]);
    });

    it("is case-insensitive about the at-rule and URL functions", () => {
        assert.deepEqual(findExternalStylesheetReferences("@IMPORT URL('https://a.example/x.css');"), [
            "@IMPORT URL('https://a.example/x.css');",
        ]);
    });
});
