import { MsgType, type MatrixClient } from "matrix-js-sdk";

/**
 * Send one plaintext message. Thin on purpose: the SDK owns the local echo
 * lifecycle (insert → status flips → remote-echo replacement), and the feed
 * maps every transition. Kept separate from the client so the content shape
 * is unit-testable without a homeserver.
 */
export async function sendTextMessage(
    matrix: MatrixClient,
    roomId: string,
    body: string,
): Promise<void> {
    await matrix.sendMessage(roomId, { msgtype: MsgType.Text, body });
}
