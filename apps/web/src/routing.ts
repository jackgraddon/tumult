/**
 * Room ids contain `!` and `:`, so route params land percent-encoded.
 * Everything goes through here so a later slug scheme has one place to land.
 */
export function encodeRoomId(roomId: string): string {
    return encodeURIComponent(roomId);
}

export function decodeRoomId(param: string): string {
    return decodeURIComponent(param);
}

export function encodeGuildId(guildId: string): string {
    return encodeURIComponent(guildId);
}

export function decodeGuildId(param: string): string {
    return decodeURIComponent(param);
}
