/** Navigation and permission policy. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callOriginFrom, externalUrl, isAppUrl, originOf, permissionAllowed } from "../src/policy.ts";

describe("isAppUrl", () => {
    it("is app://tumult only", () => {
        assert.equal(isAppUrl("app://tumult/dms"), true);
        assert.equal(isAppUrl("app://tumult"), true);
        assert.equal(isAppUrl("app://other/"), false);
        assert.equal(isAppUrl("https://tumult/"), false);
        assert.equal(isAppUrl("file:///etc/passwd"), false);
    });
});

describe("externalUrl", () => {
    it("lets only http(s) out to the OS browser", () => {
        assert.equal(externalUrl("https://example.org/a?b#c"), "https://example.org/a?b#c");
        assert.equal(externalUrl("http://example.org/"), "http://example.org/");
        for (const url of ["file:///etc/passwd", "javascript:alert(1)", "app://tumult/", "smb://host/share", "ms-settings:", "mailto:a@b", "nope"]) {
            assert.equal(externalUrl(url), null, url);
        }
        assert.equal(externalUrl("https://user:pw@example.org/"), null);
    });
});

describe("originOf", () => {
    it("gives app://tumult for the app scheme (URL.origin would say 'null')", () => {
        assert.equal(originOf("app://tumult/dms?x#y"), "app://tumult");
        assert.equal(originOf("https://call.example.org/room#/x"), "https://call.example.org");
        assert.equal(originOf("data:text/html,x"), null);
        assert.equal(originOf(""), null);
        assert.equal(originOf(undefined), null);
    });
});

describe("permissionAllowed", () => {
    const app = { requestingOrigin: "app://tumult", topOrigin: "app://tumult", callOrigin: null };

    it("grants the app media, screen capture, notifications and clipboard write", () => {
        for (const permission of ["media", "display-capture", "notifications", "clipboard-sanitized-write"]) {
            assert.equal(permissionAllowed({ ...app, permission }), true, permission);
        }
    });

    it("denies the app everything else", () => {
        for (const permission of ["geolocation", "clipboard-read", "midi", "midiSysex", "openExternal", "pointerLock", "hid", "usb", "serial", "idle-detection", "unknown"]) {
            assert.equal(permissionAllowed({ ...app, permission }), false, permission);
        }
    });

    it("denies any other top-level origin (the auth window's IdP pages)", () => {
        assert.equal(permissionAllowed({ permission: "media", requestingOrigin: "https://mas.example.org", topOrigin: "https://mas.example.org", callOrigin: null }), false);
        assert.equal(permissionAllowed({ permission: "notifications", requestingOrigin: "app://tumult", topOrigin: null, callOrigin: null }), false);
    });

    it("grants the configured call frame media and screen capture, nothing else", () => {
        const call = { requestingOrigin: "https://call.example.org", topOrigin: "app://tumult", callOrigin: "https://call.example.org" };
        assert.equal(permissionAllowed({ ...call, permission: "media" }), true);
        assert.equal(permissionAllowed({ ...call, permission: "display-capture" }), true);
        assert.equal(permissionAllowed({ ...call, permission: "notifications" }), false);
        assert.equal(permissionAllowed({ ...call, permission: "geolocation" }), false);
        assert.equal(permissionAllowed({ ...call, callOrigin: null, permission: "media" }), false, "no call frame when calls are off");
        assert.equal(permissionAllowed({ ...call, requestingOrigin: "https://evil.example", permission: "media" }), false);
    });

    it("denies the sandboxed plugin frame (opaque origin)", () => {
        assert.equal(permissionAllowed({ permission: "media", requestingOrigin: null, topOrigin: "app://tumult", callOrigin: null }), false);
    });
});

describe("callOriginFrom", () => {
    it("keeps the origin only, as the web build's CSP does", () => {
        assert.equal(callOriginFrom("https://call.example.org/path/index.html"), "https://call.example.org");
        assert.equal(callOriginFrom(""), null);
        assert.equal(callOriginFrom(undefined), null);
        assert.equal(callOriginFrom("javascript:x"), null);
    });
});
