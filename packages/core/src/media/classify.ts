/**
 * Whether a media fetch failed in a way a retry cannot fix.
 *
 * A server answering 4xx has made a verdict about the media itself: 404
 * (purged or never uploaded), 400 (not a format the endpoint can serve), 403
 * (no access). Re-requesting the same URI gets the same answer, so the
 * resolver remembers it instead of re-hammering the server on every timeline
 * rebuild. Everything else is worth another attempt: a dropped connection
 * (no `httpStatus` at all), 5xx, 408 (request timeout), 429 (rate limited).
 *
 * SDK-free on purpose — the renderer gates its retry affordance with the same
 * rule, and importing this must not drag matrix-js-sdk into the UI bundle.
 */
export function isTerminalMediaError(error: unknown): boolean {
    const status = (error as { httpStatus?: unknown } | null | undefined)?.httpStatus;
    if (typeof status !== "number") return false;
    if (status === 408 || status === 429) return false;
    return status >= 400 && status < 500;
}
