import type { MatrixClient } from "matrix-js-sdk";
// Value imports need the .js extension: Node's ESM loader won't guess it
// (typecheck and Vite both resolve the extensionless form, so the build
// forgives this — only `node --test` catches it).
import { EventType } from "matrix-js-sdk/lib/@types/event.js";
import { Preset } from "matrix-js-sdk/lib/@types/partials.js";

import type {
    CreateChannelParams,
    CreateDmParams,
    CreateSpaceParams,
    UserSearchResult,
} from "../contract.ts";
import { setMembersCanJoinCalls } from "./calls.ts";

const MEGOLM = "m.megolm.v1.aes-sha2";

/**
 * Let every member of a room we just created join its calls.
 *
 * Joining a MatrixRTC call (compatibility mode, see voice/sfu.ts) is sending an
 * `org.matrix.msc3401.call.member` STATE event, and the presets leave state
 * events at `state_default` (50) — so without this only the creator could join
 * and everyone else was refused with M_FORBIDDEN. Element creates rooms with
 * it at 0; so do we. How the write is done (and why not on createRoom) is
 * `setMembersCanJoinCalls`'s business.
 *
 * Never throws: the room already exists, and reporting a failed create for it
 * would be worse than calls being admin-only in it. The failure is logged, and
 * an admin can still open them from room settings.
 */
async function allowCallsForMembers(matrix: MatrixClient, roomId: string): Promise<void> {
    try {
        await setMembersCanJoinCalls(matrix, roomId, true);
    } catch (error) {
        console.warn(`[tumult] could not open calls to members of ${roomId}; only admins can join them`, error);
    }
}

/**
 * Lifecycle verbs (create / join / leave / invite) plus directory search.
 * Free functions over the SDK so the call shapes are unit-testable without a
 * homeserver — same split as redact.ts and search.ts.
 *
 * Every creator resolves with the new room id BEFORE the room lands in
 * `rooms`: the feed only refreshes on the next sync. Callers (the shell)
 * must wait for the id to appear in `client.rooms` before selecting it.
 */

export async function createSpace(matrix: MatrixClient, params: CreateSpaceParams): Promise<string> {
    const { room_id: roomId } = await matrix.createRoom({
        name: params.name,
        ...(params.topic !== undefined ? { topic: params.topic } : {}),
        creation_content: { type: "m.space" },
    });
    return roomId;
}

export async function createChannel(
    matrix: MatrixClient,
    spaceId: string,
    params: CreateChannelParams,
): Promise<string> {
    const domain = matrix.getDomain();
    if (!domain) throw new Error("Cannot create a channel without a homeserver domain");

    const encrypted = params.encrypted === true;
    const isPublic = params.visibility === "public";
    const alias = params.aliasLocalpart?.trim();
    const { room_id: roomId } = await matrix.createRoom({
        name: params.name,
        ...(params.topic !== undefined ? { topic: params.topic } : {}),
        preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
        ...(isPublic && alias !== undefined && alias.length > 0 ? { room_alias_name: alias } : {}),
        ...(encrypted
            ? { initial_state: [{ type: "m.room.encryption", content: { algorithm: MEGOLM } }] }
            : {}),
    });
    await allowCallsForMembers(matrix, roomId);

    // Link the channel into its space. `via` must be non-empty: snapshotRooms
    // treats an empty/absent via as a REMOVED link and drops the parent, so a
    // link written without it would never show up in the rail's tree.
    await matrix.sendStateEvent(spaceId, EventType.SpaceChild, { via: [domain] }, roomId);
    // The backlink is for spec correctness (other clients, and a child that
    // wants to know its parents without scanning every space); our snapshot
    // reads only the child, but both halves is what Element writes.
    await matrix.sendStateEvent(roomId, EventType.SpaceParent, { via: [domain] }, spaceId);
    return roomId;
}

export async function createDm(matrix: MatrixClient, params: CreateDmParams): Promise<string> {
    const { room_id: roomId } = await matrix.createRoom({
        preset: Preset.PrivateChat,
        is_direct: true,
        invite: [params.userId],
        ...(params.encrypted === true
            ? { initial_state: [{ type: "m.room.encryption", content: { algorithm: MEGOLM } }] }
            : {}),
    });
    await allowCallsForMembers(matrix, roomId);
    // Record the mapping so other clients file this under DMs too. Merge, not
    // replace: m.direct holds every DM on the account and overwriting it would
    // un-file everyone else's.
    const current = matrix.getAccountData(EventType.Direct)?.getContent() as Record<string, string[]> | undefined;
    const merged: Record<string, string[]> = { ...current };
    const forUser = new Set([...(merged[params.userId] ?? []), roomId]);
    merged[params.userId] = [...forUser];
    await matrix.setAccountData(EventType.Direct, merged);
    return roomId;
}

export async function joinRoom(matrix: MatrixClient, idOrAlias: string): Promise<string> {
    const room = await matrix.joinRoom(idOrAlias);
    return room.roomId;
}

export async function leaveRoom(matrix: MatrixClient, roomId: string): Promise<void> {
    await matrix.leave(roomId);
}

export async function inviteToRoom(matrix: MatrixClient, roomId: string, userId: string): Promise<void> {
    await matrix.invite(roomId, userId);
}

/** How many directory results to ask for; plenty for a picker, cheap for the server. */
export const USER_SEARCH_LIMIT = 10;

export async function searchUserDirectory(
    matrix: MatrixClient,
    term: string,
    limit: number = USER_SEARCH_LIMIT,
): Promise<UserSearchResult[]> {
    const trimmed = term.trim();
    // An empty term isn't a query: the directory would return a random page.
    if (trimmed.length === 0) return [];
    const response = await matrix.searchUserDirectory({ term: trimmed, limit });
    return response.results.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name ?? r.user_id,
        avatarUrl: typeof r.avatar_url === "string" && r.avatar_url.startsWith("mxc://") ? r.avatar_url : null,
    }));
}
