/**
 * HEIC/HEIF (iPhone photos) decodes only in Safari, so a HEIC sent as-is is
 * an `m.image` most receivers — and the homeserver's thumbnailer — cannot
 * show. Staging converts it to JPEG first. The decoder (libheif as WASM,
 * ~3 MB) is only ever `import()`ed, so it is a lazy chunk fetched the first
 * time someone picks a HEIC, never part of the composer's own bundle.
 */

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

/** By type, or by extension when the OS hands over an empty/generic type. */
export function looksHeic(file: File): boolean {
    if (HEIC_TYPES.has(file.type.toLowerCase())) return true;
    return (file.type === "" || file.type === "application/octet-stream") && /\.(heic|heif)$/i.test(file.name);
}

/** `IMG_1.HEIC` → `IMG_1.jpg`. */
export function jpegName(name: string): string {
    return /\.(heic|heif)$/i.test(name) ? name.replace(/\.(heic|heif)$/i, ".jpg") : `${name}.jpg`;
}

/**
 * The JPEG to send in place of a HEIC. Rejects when the bytes do not decode;
 * the caller then keeps the original (it still sends, as a file).
 */
export async function heicToJpeg(file: File): Promise<File> {
    // The CSP build: no eval, so it runs under our script-src.
    const { heicTo } = await import("heic-to/csp");
    const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
    return new File([jpeg], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}
