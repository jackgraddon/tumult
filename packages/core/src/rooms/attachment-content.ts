import { ALT_TEXT_KEY, type OutgoingAttachment } from "../contract.ts";

/**
 * The `m.room.message` content for one uploaded file. SDK-free on purpose:
 * the fake client builds its echoes with the same function, so the browser
 * smoke test renders exactly the shape the real client sends.
 */
export function attachmentContent(
    attachment: OutgoingAttachment,
    url: string,
    caption?: string,
): Record<string, unknown> {
    const { file } = attachment;
    const msgtype = msgtypeForFile(file);
    const name = attachment.name ?? (file instanceof File ? file.name : "file");
    const info: Record<string, unknown> = { mimetype: file.type, size: file.size };
    // Dimensions let every receiver reserve the box before the bytes arrive.
    if ((msgtype === "m.image" || msgtype === "m.video") && attachment.width && attachment.height) {
        info["w"] = attachment.width;
        info["h"] = attachment.height;
    }
    const alt = attachment.altText?.trim();
    return {
        msgtype,
        // MSC2530: body == filename means "no caption"; a differing body IS
        // the caption. The spec has no alt-text field any more (v1.10 turned
        // the old "alt text or filename" body into the caption), so alt text
        // travels under our namespace and never masquerades as a caption.
        body: caption || name,
        filename: name,
        url,
        info,
        ...(alt ? { [ALT_TEXT_KEY]: alt } : {}),
    };
}

export function msgtypeForFile(file: File | Blob): "m.image" | "m.video" | "m.audio" | "m.file" {
    if (file.type.startsWith("image/")) return "m.image";
    if (file.type.startsWith("video/")) return "m.video";
    if (file.type.startsWith("audio/")) return "m.audio";
    return "m.file";
}
