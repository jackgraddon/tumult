/**
 * What a SANDBOX-lane plugin may do across the bridge.
 *
 * The bridge used to reflect the whole `ChatClient`: a plugin that declared
 * only `["styles"]` — shown on the consent screen as "Sandboxed", no warning —
 * could read every decrypted room, send and redact as the user, moderate, log
 * out, mint a recovery key and confirm emoji verification (security review
 * finding F1). The sandbox lane's permissions are `commands`,
 * `composer-actions` and `styles`, and nothing in them conveys any of that.
 *
 * So every client member is classified here, and the type below makes the
 * classification COMPLETE: a new `ChatClient` member fails the build until
 * someone decides its rule. Deny is the default meaning of being here.
 *
 *  - `invokedRoom`: allowed only for the room of an invocation the user
 *    triggered (they ran the plugin's command or clicked its composer action
 *    in that room), and only while that invocation is running. The first
 *    argument must be that room id. A feed opened this way is closed when the
 *    room's last invocation settles, so a plugin cannot keep reading a room
 *    after its action is done.
 *  - `always`: carries no user data (capability flags, connection state).
 *  - `deny`: everything else — account and session, recovery and
 *    verification, moderation and settings, profile and presence, room
 *    lifecycle, every all-rooms or member read, search, and media.
 *
 * What the shipped sandbox plugins use — the template's command (`send`), the
 * showcase command (`send`) and composer action (`timeline` + `toggleReaction`)
 * — is exactly the `invokedRoom` set's core.
 */
import type { ChatClient } from "@tumult/core";

import type { ContextMethod } from "./protocol.ts";

export type BridgeRule = "invokedRoom" | "always" | "deny";

export const CLIENT_RULES: Readonly<Record<keyof ChatClient, BridgeRule>> = {
    // Acting in the room the user invoked the plugin in.
    send: "invokedRoom",
    sendReply: "invokedRoom",
    toggleReaction: "invokedRoom",
    sendTyping: "invokedRoom",
    loadMore: "invokedRoom",
    timeline: "invokedRoom",

    // No user data.
    supportsThreads: "always",
    hasMoreRooms: "always",
    connection: "always",

    // Account and session.
    login: "deny",
    completeLogin: "deny",
    restoreSession: "deny",
    logout: "deny",
    start: "deny",
    stop: "deny",
    session: "deny",
    // Recovery and verification.
    security: "deny",
    verification: "deny",
    setupRecovery: "deny",
    restoreBackup: "deny",
    startVerification: "deny",
    acceptVerification: "deny",
    declineVerification: "deny",
    confirmSas: "deny",
    mismatchSas: "deny",
    listDevices: "deny",
    // Moderation and room settings.
    kick: "deny",
    ban: "deny",
    unban: "deny",
    setPowerLevel: "deny",
    updateRoomSettings: "deny",
    powerLevels: "deny",
    banned: "deny",
    // Profile and presence.
    setProfile: "deny",
    setOwnPresence: "deny",
    setProfileField: "deny",
    profileFieldsSupported: "deny",
    profile: "deny",
    ownPresence: "deny",
    profileField: "deny",
    // Room lifecycle and navigation.
    createSpace: "deny",
    createChannel: "deny",
    createDm: "deny",
    joinRoom: "deny",
    leave: "deny",
    invite: "deny",
    setRoomSelection: "deny",
    loadMoreRooms: "deny",
    // Reads beyond the invoked room, and anything that changes other messages.
    rooms: "deny",
    members: "deny",
    loadMembers: "deny",
    threads: "deny",
    threadTimeline: "deny",
    typing: "deny",
    notifications: "deny",
    search: "deny",
    searchUsers: "deny",
    jumpTo: "deny",
    redact: "deny",
    edit: "deny",
    retry: "deny",
    markRead: "deny",
    markThreadRead: "deny",
    sendMediaMessage: "deny",
    sendAttachments: "deny",
    resolveMedia: "deny",
    resolveMediaDownload: "deny",
    resolveEncryptedMedia: "deny",
    requestNotificationPermission: "deny",
    setRoomPinned: "deny",
    setRoomMuted: "deny",
    // Calls and voice: joining, media devices, who is in a call.
    supportsCalls: "deny",
    supportsVoice: "deny",
    call: "deny",
    joinCall: "deny",
    leaveCall: "deny",
    attachCall: "deny",
    voice: "deny",
    voiceRooms: "deny",
    voiceSettings: "deny",
    joinVoice: "deny",
    leaveVoice: "deny",
    setVoiceMuted: "deny",
    setVoiceDeafened: "deny",
    setVoiceCamera: "deny",
    setVoiceScreenShare: "deny",
    setVoiceSettings: "deny",
    setVoiceUserVolume: "deny",
    attachVoiceVideo: "deny",
};

/**
 * Shell context calls. Each either navigates, changes room state directly
 * (pin, mute, mark read) or opens a dialog acting on a room the plugin names —
 * none of which `commands` or `composer-actions` convey.
 */
export const CONTEXT_RULES: Readonly<Record<ContextMethod, BridgeRule>> = {
    "selection:select": "deny",
    "actions:requestLeave": "deny",
    "actions:requestModeration": "deny",
    "actions:requestMarkRead": "deny",
    "actions:requestPinRoom": "deny",
    "actions:requestMuteRoom": "deny",
    "actions:requestMarkSpaceRead": "deny",
    "actions:requestSpaceSettings": "deny",
    "actions:requestSpaceInvite": "deny",
    "actions:requestSpaceCreateChannel": "deny",
};

/** The room an invocation runs in: commands and composer actions get `{ roomId }`. */
export function invocationRoom(args: readonly unknown[]): string | null {
    const first = args[0];
    if (typeof first !== "object" || first === null) return null;
    const roomId = (first as { roomId?: unknown }).roomId;
    return typeof roomId === "string" && roomId.length > 0 ? roomId : null;
}

/**
 * Decide one call. `activeRooms` holds the rooms with a live invocation.
 * Returns null when allowed, or the reason it is refused (sent to the plugin,
 * so it can tell its author which call needs which lane).
 */
export function checkCall(method: string, args: readonly unknown[], activeRooms: ReadonlySet<string>): string | null {
    const rule = (CLIENT_RULES as Record<string, BridgeRule | undefined>)[method] ?? (CONTEXT_RULES as Record<string, BridgeRule | undefined>)[method];
    if (rule === undefined) return `client.${method} is not part of the sandbox bridge`;
    if (rule === "always") return null;
    if (rule === "deny") return `client.${method} is not available to sandboxed plugins`;
    const roomId = args[0];
    if (typeof roomId !== "string" || !activeRooms.has(roomId)) {
        return `client.${method} is only available for the room the plugin was invoked in, while it runs`;
    }
    return null;
}
