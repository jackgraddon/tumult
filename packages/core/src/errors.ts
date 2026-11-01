/**
 * One translator from a failed request to a sentence a person can read.
 *
 * matrix-js-sdk's errors are written for developers: a `MatrixError`'s
 * `message` embeds the request URL ("MatrixError: [403] … (https://hs/_matrix/…)"),
 * a `ConnectionError` wraps fetch's "Failed to fetch", and the SDK often nests
 * the real error several `cause`s deep. Every surface that reports a failure
 * goes through here instead of showing `error.message`.
 *
 * UI-safe on purpose: no matrix-js-sdk import (the errors are read by shape —
 * `errcode`, `httpStatus`, `data`, `name` — which is also what survives a
 * structured clone), so the fake build can reach it via `@tumult/core/errors`.
 */

export interface DescribeErrorOptions {
    /** The homeserver's upload limit in bytes (`m.upload.size`), when known, for M_TOO_LARGE / 413. */
    readonly maxUploadBytes?: number | null;
    /**
     * Show the app's OWN error messages (anything that is not a request
     * failure) verbatim, even long or URL-bearing ones. For surfaces whose own
     * errors are deliberate diagnostics — login's client-metadata validation
     * names the offending URL, voice names the discovery requests it tried.
     */
    readonly verbatimOwn?: boolean;
}

interface Found {
    readonly errcode?: string;
    readonly status?: number;
    readonly serverText?: string;
    readonly retryAfterMs?: number;
}

/**
 * Describe `error` as one sentence. With a `context` ("Couldn't ban Bob") the
 * result reads "Couldn't ban Bob: you don't have permission in this room."
 * An aborted request is something the user (or the app) chose, so it returns
 * `""` — callers treat the empty string as "show nothing".
 */
export function describeError(error: unknown, context?: string, options: DescribeErrorOptions = {}): string {
    if (isAbort(error)) return "";
    if (options.verbatimOwn && !isRequestFailure(error)) {
        const own = typeof error === "string" ? error : error instanceof Error ? error.message : "";
        if (own.trim()) return own;
    }
    const reason = explain(error, options);
    if (!context) return capitalize(reason);
    return `${context.replace(/[.:]\s*$/, "")}: ${reason}`;
}

/**
 * `describeError` plus the developer half: the raw error goes to the console
 * with the same context, at the same place the sentence is produced, so the
 * translation never swallows what actually happened.
 */
export function reportError(error: unknown, context: string, options?: DescribeErrorOptions): string {
    const sentence = describeError(error, context, options);
    if (sentence) console.error(`[tumult] ${context}`, error);
    else console.warn(`[tumult] ${context} (aborted)`, error);
    return sentence;
}

function explain(error: unknown, options: DescribeErrorOptions): string {
    const found = findHttp(error);
    if (found) return fromHttp(found, options);
    if (isNetwork(error)) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        return offline
            ? "you appear to be offline. Check your connection and try again."
            : "couldn't reach the server. Check your connection, or the server may be down or blocking this app.";
    }
    if (isTimeout(error)) return "the server took too long to answer. Try again in a moment.";
    // Our own errors (core's validation, "Cannot rejoin voice …") are already
    // sentences; anything that looks like a raw dump is not shown.
    const own = ownMessage(error);
    if (own) return own;
    return "something went wrong. Try again in a moment.";
}

function fromHttp(found: Found, options: DescribeErrorOptions): string {
    const { errcode, status } = found;
    switch (errcode) {
        case "M_FORBIDDEN":
            return "you don't have permission to do that here.";
        case "M_LIMIT_EXCEEDED":
            return rateLimited(found.retryAfterMs);
        case "M_TOO_LARGE":
            return tooLarge(options.maxUploadBytes);
        case "M_NOT_FOUND":
            return "it couldn't be found. It may have been removed, or you may no longer have access.";
        case "M_UNKNOWN_TOKEN":
        case "M_MISSING_TOKEN":
            return "your session has expired. Sign in again to continue.";
        case "M_USER_DEACTIVATED":
            return "this account has been deactivated.";
        case "M_USER_IN_USE":
            return "that username is already taken.";
        case "M_ROOM_IN_USE":
            return "that room address is already in use. Pick a different one.";
        case "M_INVALID_PARAM":
        case "M_BAD_JSON":
        case "M_NOT_JSON":
            return withServerText("the homeserver rejected the request as invalid", found.serverText);
        case "M_UNRECOGNIZED":
            return "your homeserver doesn't support this.";
        case "M_GUEST_ACCESS_FORBIDDEN":
            return "guests can't do that here. Sign in with a full account.";
        case "M_RESOURCE_LIMIT_EXCEEDED":
            return "your homeserver has reached a usage limit. Contact its administrator.";
        case "M_UNSUPPORTED_ROOM_VERSION":
        case "M_INCOMPATIBLE_ROOM_VERSION":
            return "your homeserver doesn't support this room's version.";
        case "M_EXCLUSIVE":
            return "that name is reserved on this homeserver.";
        case "M_USER_NOT_FOUND":
            return "that user couldn't be found.";
        case "M_CANNOT_LEAVE_SERVER_NOTICE_ROOM":
            return "this is a server notices room, which can't be left.";
    }
    if (status === 401) return "your session has expired. Sign in again to continue.";
    if (status === 403) return "you don't have permission to do that here.";
    if (status === 404) return "it couldn't be found. It may have been removed, or you may no longer have access.";
    if (status === 408) return "the server took too long to answer. Try again in a moment.";
    if (status === 413) return tooLarge(options.maxUploadBytes);
    if (status === 429) return rateLimited(found.retryAfterMs);
    if (status === 502 || status === 503 || status === 504) {
        return "the server is unreachable or overloaded right now. Try again in a moment.";
    }
    if (status !== undefined && status >= 500) return "the server ran into a problem. Try again in a moment.";
    return withServerText("something went wrong", found.serverText);
}

function rateLimited(retryAfterMs: number | undefined): string {
    if (retryAfterMs && retryAfterMs > 0) {
        const seconds = Math.ceil(retryAfterMs / 1000);
        return `you're doing that too often. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
    }
    return "you're doing that too often. Wait a moment and try again.";
}

function tooLarge(maxBytes: number | null | undefined): string {
    return maxBytes && maxBytes > 0
        ? `it's too large. Your homeserver accepts files up to ${formatBytes(maxBytes)}.`
        : "it's too large for your homeserver.";
}

function withServerText(lead: string, text: string | undefined): string {
    return text ? `${lead} (“${text.replace(/[.\s]+$/, "")}”).` : `${lead}. Try again in a moment.`;
}

export function formatBytes(bytes: number): string {
    const units = ["bytes", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[unit]}`;
}

/** Walk the `cause` chain to the first error that came back from an HTTP request. */
function findHttp(error: unknown): Found | null {
    let current: unknown = error;
    for (let depth = 0; isObject(current) && depth < 8; depth++) {
        const { errcode, httpStatus, data } = current as { errcode?: unknown; httpStatus?: unknown; data?: unknown };
        const hasCode = typeof errcode === "string" && errcode.length > 0;
        const hasStatus = typeof httpStatus === "number" && httpStatus > 0;
        if (hasCode || hasStatus) {
            const body = isObject(data) ? (data as { error?: unknown; retry_after_ms?: unknown }) : {};
            const headerRetry = retryFromHeaders(current);
            return {
                ...(hasCode ? { errcode: errcode as string } : {}),
                ...(hasStatus ? { status: httpStatus as number } : {}),
                ...(typeof body.error === "string" && isHuman(body.error) ? { serverText: body.error } : {}),
                ...(typeof body.retry_after_ms === "number"
                    ? { retryAfterMs: body.retry_after_ms }
                    : headerRetry !== null
                      ? { retryAfterMs: headerRetry }
                      : {}),
            };
        }
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}

function retryFromHeaders(error: object): number | null {
    const getter = (error as { getRetryAfterMs?: unknown }).getRetryAfterMs;
    if (typeof getter !== "function") return null;
    try {
        const ms: unknown = getter.call(error);
        return typeof ms === "number" ? ms : null;
    } catch {
        return null;
    }
}

function chain(error: unknown): object[] {
    const out: object[] = [];
    let current: unknown = error;
    for (let depth = 0; isObject(current) && depth < 8; depth++) {
        out.push(current);
        current = (current as { cause?: unknown }).cause;
    }
    return out;
}

function nameOf(error: object): string {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
}

function messageOf(error: object): string {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
}

/** True when the error came from a request: an HTTP answer, no answer at all, a timeout or an abort. */
export function isRequestFailure(error: unknown): boolean {
    return findHttp(error) !== null || isNetwork(error) || isTimeout(error) || isAbort(error);
}

/** True for an aborted request (the user or app cancelled it): nothing to report. */
export function isAbort(error: unknown): boolean {
    return chain(error).some((e) => nameOf(e) === "AbortError");
}

function isTimeout(error: unknown): boolean {
    return chain(error).some((e) => nameOf(e) === "TimeoutError");
}

/**
 * A request that never got an answer: the SDK's `ConnectionError`, or fetch's
 * own `TypeError` ("Failed to fetch" in Chromium, "NetworkError when
 * attempting to fetch resource." in Firefox, "Load failed" in Safari). A CORS
 * refusal is indistinguishable from this in the browser by design.
 */
function isNetwork(error: unknown): boolean {
    return chain(error).some((e) => {
        if (nameOf(e) === "ConnectionError") return true;
        return nameOf(e) === "TypeError" && /failed to fetch|networkerror|load failed|network request failed/i.test(messageOf(e));
    });
}

function ownMessage(error: unknown): string | null {
    const text = typeof error === "string" ? error : isObject(error) ? messageOf(error) : "";
    if (!isHuman(text)) return null;
    // Plain `Error`s only: a TypeError/RangeError message is a bug report, not a reason.
    if (isObject(error) && !["Error", ""].includes(nameOf(error))) return null;
    return lowerFirst(text.trim());
}

/** Text written for a person: short, one line, no URL, no JSON, no Matrix code, no stack. */
export function isHuman(text: string): boolean {
    const t = text.trim();
    if (t.length === 0 || t.length > 200) return false;
    if (/\n|https?:\/\/|\bM_[A-Z_]+\b|^\s*[{[]|\[\d{3}\]|\bat \S+:\d+|MatrixError|Error:/.test(t)) return false;
    return true;
}

function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Lowercase a leading capital so "Couldn't X: The thing…" reads as one sentence, unless it's an acronym. */
function lowerFirst(text: string): string {
    if (/^[A-Z][A-Z]/.test(text)) return text;
    return text.charAt(0).toLowerCase() + text.slice(1);
}
