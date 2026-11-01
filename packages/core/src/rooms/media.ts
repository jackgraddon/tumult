import type { MatrixClient } from "matrix-js-sdk";
import { uploadWithRefresh } from "../util/token-refresh.ts";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { AttachmentSendResult, OutgoingAttachment, SendAttachmentsOptions } from "../contract.ts";
import { attachmentContent } from "./attachment-content.ts";

/**
 * Upload a media file and send it as an `m.room.message`.
 *
 * The file is uploaded to the homeserver first (the SDK handles encryption
 * for encrypted rooms), then a message is sent with the resulting `mxc://`
 * URI. The SDK owns the local echo lifecycle; the feed maps every transition.
 * Kept separate from the client so the content shape is unit-testable without
 * a homeserver.
 */
export async function sendMediaMessage(
    matrix: MatrixClient,
    roomId: string,
    file: File | Blob,
    body?: string,
): Promise<void> {
    await sendOneAttachment(matrix, roomId, { file }, body);
}

/**
 * Send staged attachments, in order, with an optional caption.
 *
 * Caption placement follows MSC2530 (spec v1.10): a media event whose
 * `filename` differs from its `body` carries `body` as its caption. One file
 * takes the caption on its own event; several files cannot share one, so the
 * caption goes out first as a plain text message (the reply relation rides on
 * whichever event goes first). Each file settles independently — a failed
 * upload has no local echo, so the per-file result is the only place the
 * failure can surface, and the batch carries on past it.
 */
export async function sendAttachments(
    matrix: MatrixClient,
    roomId: string,
    attachments: readonly OutgoingAttachment[],
    options: SendAttachmentsOptions,
    sendText: (body: string, replyToEventId?: string) => Promise<void>,
): Promise<AttachmentSendResult[]> {
    const caption = options.caption?.trim() ?? "";
    let replyTo = options.replyToEventId;
    if (caption && attachments.length > 1) {
        // A text failure surfaces in-timeline through its own echo.
        await sendText(caption, replyTo).catch(() => undefined);
        replyTo = undefined;
    }
    const results: AttachmentSendResult[] = [];
    for (const attachment of attachments) {
        try {
            await sendOneAttachment(
                matrix,
                roomId,
                attachment,
                attachments.length === 1 ? caption : "",
                replyTo,
            );
            results.push({ ok: true });
        } catch (error) {
            results.push({ ok: false, error });
        }
        replyTo = undefined;
    }
    return results;
}

/**
 * The homeserver's advertised upload limit (`m.upload.size`), or `null` when
 * it advertises none or the read fails — unknown must never block a send.
 * Uses the authenticated endpoint on v1.11+ servers, else the legacy one.
 * This is the HOMESERVER's limit only: a proxy in front of it (nginx's
 * default is 1 MB) can be lower, and nothing in the protocol reveals that.
 */
export async function readUploadLimit(matrix: MatrixClient): Promise<number | null> {
    try {
        const authed = await matrix.isVersionSupported("v1.11").catch(() => false);
        const size = (await matrix.getMediaConfig(authed))["m.upload.size"];
        return typeof size === "number" && size > 0 ? size : null;
    } catch (error) {
        console.warn("[tumult] could not read the media upload limit", error);
        return null;
    }
}

async function sendOneAttachment(
    matrix: MatrixClient,
    roomId: string,
    attachment: OutgoingAttachment,
    caption?: string,
    replyToEventId?: string,
): Promise<void> {
    const { content_uri } = await uploadWithRefresh(matrix, attachment.file);
    const content = attachmentContent(attachment, content_uri, caption);
    if (replyToEventId) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyToEventId } };
    await matrix.sendMessage(roomId, content as unknown as RoomMessageEventContent);
}
