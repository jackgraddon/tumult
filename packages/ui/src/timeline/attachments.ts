import type { AttachmentSendResult, OutgoingAttachment } from "@tumult/core";
import { describeError } from "@tumult/core/errors";

/**
 * One file staged in the composer tray. `failed` keeps the file in the tray
 * after a send whose upload did not land: an upload has no local echo, so the
 * tray is the only honest place left to show it (and resend or remove it).
 */
export interface StagedAttachment {
    id: number;
    file: File;
    /** `blob:` preview for images/video; revoked when the item leaves the tray. */
    previewUrl: string | null;
    altText: string;
    width?: number;
    height?: number;
    /**
     * `converting`: a HEIC being turned into JPEG; the tray cannot send yet.
     * `too-large`: over the homeserver's `m.upload.size`; never sent.
     */
    status: "converting" | "staged" | "sending" | "failed" | "too-large";
    /**
     * Why a `failed` file did not land, as a sentence (`describeError`): the
     * server's reason ("Too large…", "You don't have permission…", offline),
     * never a bare "failed" and never the raw request error.
     */
    failure?: string;
}

/**
 * Mark files over the homeserver's advertised limit `too-large` (and lift the
 * mark if the limit turns out higher). Only settled files are judged: a HEIC
 * is measured after conversion, an upload in flight is left alone. A `null`
 * limit is unknown, not unlimited-or-zero, so it blocks nothing.
 */
export function applyUploadLimit(
    items: readonly StagedAttachment[],
    limit: number | null,
): StagedAttachment[] {
    return items.map((item) => {
        if (item.status !== "staged" && item.status !== "failed" && item.status !== "too-large") return item;
        const over = limit !== null && item.file.size > limit;
        if (over && item.status !== "too-large") return { ...item, status: "too-large" };
        if (!over && item.status === "too-large") return { ...item, status: "staged" };
        return item;
    });
}

export type PreviewKind = "image" | "video" | "audio" | "file";

export function previewKind(file: Blob): PreviewKind {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "file";
}

/** Chip icon for a file without a thumbnail. */
export function fileIcon(file: Blob): string {
    const kind = previewKind(file);
    if (kind === "video") return "file-video-outline";
    if (kind === "audio") return "file-music-outline";
    if (file.type.startsWith("text/") || file.type === "application/pdf") return "file-document-outline";
    return "file-outline";
}

/** Human file size: 1 decimal under 10 of a unit, whole numbers above. */
export function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const shown = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
    return `${shown} ${units[unit]}`;
}

/** The contract payload for the tray, alt text only where it means something. */
export function toOutgoing(items: readonly StagedAttachment[]): OutgoingAttachment[] {
    return items.map((item) => ({
        file: item.file,
        ...(previewKind(item.file) === "image" && item.altText.trim() ? { altText: item.altText.trim() } : {}),
        ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
    }));
}

/**
 * The tray after a send: landed files leave, failed ones stay marked `failed`.
 * A result list that does not line up (a client that threw outright) fails
 * everything rather than guessing which files went out.
 */
export function settleTray(
    items: readonly StagedAttachment[],
    results: readonly AttachmentSendResult[] | null,
    /** What the send threw, when it threw outright instead of reporting per file. */
    thrown?: unknown,
    /** The homeserver's upload limit, so a "too large" reason can name it. */
    maxUploadBytes?: number | null,
): { keep: StagedAttachment[]; sent: StagedAttachment[] } {
    const keep: StagedAttachment[] = [];
    const sent: StagedAttachment[] = [];
    const aligned = results !== null && results.length === items.length;
    items.forEach((item, i) => {
        const result = aligned ? results[i] : undefined;
        if (result?.ok) {
            sent.push(item);
            return;
        }
        const cause = result && !result.ok ? result.error : thrown;
        const failure = describeError(cause, undefined, { maxUploadBytes: maxUploadBytes ?? null });
        keep.push({ ...item, status: "failed", ...(failure ? { failure } : {}) });
    });
    return { keep, sent };
}
