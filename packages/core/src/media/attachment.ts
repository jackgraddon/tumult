import type { EncryptedAttachment } from "../contract.ts";

/**
 * Encrypted attachment decryption (MSC3846 / spec §11.11.6.4).
 *
 * In encrypted rooms, media is uploaded encrypted: the event carries a
 * `file` descriptor (AES-CTR key + IV + ciphertext hash) alongside
 * `encrypted_file` metadata. The ciphertext lives at `file.url`; the key
 * is in the event's clear content (protected by the room's megolm session,
 * already decrypted by the time we see it).
 *
 * WebCrypto's AES-CTR takes the full 16-byte IV as the counter with a
 * 64-bit counter length — matching the spec's 64-bit counter + 64-bit nonce
 * layout.
 */

export type { EncryptedAttachment };

function base64ToBytes(b64: string): Uint8Array {
    const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Decrypt an encrypted attachment's ciphertext with the key from its
 * `file` descriptor. Returns the plaintext bytes.
 *
 * SHA-256 integrity is verified when the hash is present.
 */
export async function decryptAttachment(
    file: EncryptedAttachment,
    ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
    // Verify integrity against the ciphertext hash before decrypting.
    // Compare decoded bytes: the wire hash is unpadded base64 (possibly
    // url-safe), while btoa always pads — string comparison would always fail.
    const expected = file.hashes["sha256"];
    if (expected) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
        const expectedBytes = base64ToBytes(expected);
        if (digest.length !== expectedBytes.length || !digest.every((b, i) => b === expectedBytes[i])) {
            throw new Error("Attachment hash mismatch");
        }
    }

    const key = await crypto.subtle.importKey(
        "jwk",
        file.key as unknown as JsonWebKey,
        { name: "AES-CTR" },
        false,
        ["decrypt"],
    );

    const iv = base64ToBytes(file.iv);
    return crypto.subtle.decrypt(
        { name: "AES-CTR", counter: iv.buffer as ArrayBuffer, length: 64 },
        key,
        ciphertext,
    );
}
