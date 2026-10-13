import { MsgType, type MatrixClient } from "matrix-js-sdk";
import { uploadWithRefresh } from "../util/token-refresh.ts";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";

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
    const { content_uri } = await uploadWithRefresh(matrix, file);
    const msgtype = msgtypeForFile(file);
    const name = file instanceof File ? file.name : "file";
    const content = {
        msgtype,
        body: body ?? name,
        url: content_uri,
        info: {
            mimetype: file.type,
            size: file.size,
        },
    } as RoomMessageEventContent;
    await matrix.sendMessage(roomId, content);
}

function msgtypeForFile(file: File | Blob): MsgType {
    if (file.type.startsWith("image/")) return MsgType.Image;
    if (file.type.startsWith("video/")) return MsgType.Video;
    if (file.type.startsWith("audio/")) return MsgType.Audio;
    return MsgType.File;
}
