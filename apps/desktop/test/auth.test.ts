/** The MAS login leg's two URL decisions. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callbackTarget, DESKTOP_REDIRECT_URI, isAuthorizationRequest } from "../src/auth.ts";

function authorize(base: string, overrides: Record<string, string> = {}): string {
    const url = new URL(base);
    const params = { response_type: "code", client_id: "01ABC", redirect_uri: DESKTOP_REDIRECT_URI, state: "s", code_challenge: "c", ...overrides };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.href;
}

describe("DESKTOP_REDIRECT_URI", () => {
    it("is a loopback http URI (what MAS accepts for a native client)", () => {
        const url = new URL(DESKTOP_REDIRECT_URI);
        assert.equal(url.protocol, "http:");
        assert.equal(url.hostname, "127.0.0.1");
    });
});

describe("isAuthorizationRequest", () => {
    it("recognises our authorization request on an https IdP", () => {
        assert.equal(isAuthorizationRequest(authorize("https://mas.example.org/authorize")), true);
    });

    it("allows plain http only on loopback (a local homeserver)", () => {
        assert.equal(isAuthorizationRequest(authorize("http://localhost:8080/authorize")), true);
        assert.equal(isAuthorizationRequest(authorize("http://127.0.0.1:8080/authorize")), true);
        assert.equal(isAuthorizationRequest(authorize("http://mas.example.org/authorize")), false);
    });

    it("needs our redirect_uri and response_type=code", () => {
        assert.equal(isAuthorizationRequest(authorize("https://mas.example.org/authorize", { redirect_uri: "http://127.0.0.1:9/auth/callback" })), false);
        assert.equal(isAuthorizationRequest(authorize("https://mas.example.org/authorize", { response_type: "token" })), false);
        assert.equal(isAuthorizationRequest("https://example.org/"), false);
    });

    it("refuses other schemes and garbage", () => {
        assert.equal(isAuthorizationRequest(authorize("https://x/").replace("https:", "file:")), false);
        assert.equal(isAuthorizationRequest("javascript:alert(1)"), false);
        assert.equal(isAuthorizationRequest("not a url"), false);
    });
});

describe("callbackTarget", () => {
    it("maps the redirect to the app's callback route, keeping fragment and query", () => {
        assert.equal(callbackTarget(`${DESKTOP_REDIRECT_URI}#code=abc&state=xyz`), "app://tumult/auth/callback#code=abc&state=xyz");
        assert.equal(
            callbackTarget(`${DESKTOP_REDIRECT_URI}?error=access_denied&state=xyz`),
            "app://tumult/auth/callback?error=access_denied&state=xyz",
        );
        assert.equal(callbackTarget(DESKTOP_REDIRECT_URI), "app://tumult/auth/callback");
    });

    it("matches scheme, host, port and path exactly", () => {
        assert.equal(callbackTarget("http://127.0.0.1:8080/auth/callback#code=a"), null);
        assert.equal(callbackTarget("https://127.0.0.1/auth/callback#code=a"), null);
        assert.equal(callbackTarget("http://localhost/auth/callback#code=a"), null);
        assert.equal(callbackTarget("http://127.0.0.1/auth/callbackX#code=a"), null);
        assert.equal(callbackTarget("http://127.0.0.1/other"), null);
        assert.equal(callbackTarget("http://user:pw@127.0.0.1/auth/callback"), null);
        assert.equal(callbackTarget("nonsense"), null);
    });
});
