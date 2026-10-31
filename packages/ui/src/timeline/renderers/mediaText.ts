import { ALT_TEXT_KEY } from "@tumult/core/contract";

export interface MediaText {
    /** File name to label and download as. */
    name: string;
    /** MSC2530 caption, or `null` when the event carries none. */
    caption: string | null;
    /** Accessible description for an image: alt text, else caption, else name. */
    alt: string;
}

/**
 * Split a media event's text into name / caption / alt (MSC2530, spec v1.10):
 * with a `filename` that differs from `body`, `body` is a caption; without
 * one, `body` is the file name (pre-caption clients). Alt text has no spec
 * field, so it is read from our namespaced key.
 */
export function mediaText(content: Readonly<Record<string, unknown>>, body: string): MediaText {
    const filename = typeof content["filename"] === "string" ? content["filename"] : "";
    const name = filename || body;
    const caption = filename && body && body !== filename ? body : null;
    const rawAlt = content[ALT_TEXT_KEY];
    const alt = typeof rawAlt === "string" && rawAlt.trim() ? rawAlt.trim() : caption ?? name;
    return { name, caption, alt };
}
