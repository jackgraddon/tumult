/** Navigation and permission policy. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { askingOrigin, callOriginFrom, externalUrl, isAppUrl, isSandboxFrameUrl, loginPending, originOf, permissionAllowed } from "../src/policy.ts";

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

describe("askingOrigin", () => {
    it("never treats the opaque plugin sandbox frame as the app, whatever Electron reports", () => {
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/sandbox.html" }), null);
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/sandbox.html", requestingOrigin: "app://tumult" }), null);
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/sandbox.js", securityOrigin: "app://tumult" }), null);
        assert.ok(isSandboxFrameUrl("app://tumult/sandbox.html?x=1"));
        assert.ok(!isSandboxFrameUrl("app://tumult/dms"));
    });
    it("prefers the security origin over the frame URL", () => {
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/dms", securityOrigin: "null" }), null);
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/dms", securityOrigin: "app://tumult" }), "app://tumult");
        assert.equal(askingOrigin({ requestingUrl: "https://call.example/room", securityOrigin: "https://call.example" }), "https://call.example");
    });
    it("falls back to the requesting origin, then the URL", () => {
        assert.equal(askingOrigin({ requestingOrigin: "app://tumult", requestingUrl: "app://tumult/dms" }), "app://tumult");
        assert.equal(askingOrigin({ requestingUrl: "app://tumult/dms" }), "app://tumult");
    });
    it("so the sandbox frame gets nothing even inside the app window", () => {
        const origin = askingOrigin({ requestingUrl: "app://tumult/sandbox.html" });
        for (const permission of ["media", "notifications", "clipboard-sanitized-write", "display-capture"]) {
            assert.equal(permissionAllowed({ permission, requestingOrigin: origin, topOrigin: "app://tumult", callOrigin: null }), false, permission);
        }
    });
});

describe("loginPending", () => {
    it("is true only on the app's login route", () => {
        assert.ok(loginPending("app://tumult/login"));
        assert.ok(loginPending("app://tumult/login?next=%2Fdms"));
        assert.ok(!loginPending("app://tumult/dms"));
        assert.ok(!loginPending("app://tumult/loginx"));
        assert.ok(!loginPending("https://evil.example/login"));
    });
});
