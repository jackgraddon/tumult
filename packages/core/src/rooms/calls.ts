import { EventType, type MatrixClient } from "matrix-js-sdk";

import { CALL_MEMBER_EVENT_TYPE } from "../contract.ts";

interface PowerLevelsContent {
    events?: Record<string, number>;
    state_default?: number;
    users_default?: number;
}

/**
 * Open or close a room's calls to its members: set the power level of the
 * `call.member` state event to the default user level (open), or back above it
 * (closed). Used when we create a room (open) and by the room-settings toggle.
 *
 * Reads the room's ACTUAL power levels and changes that one entry. Never
 * `power_level_content_override` on createRoom: Synapse applies it with a
 * SHALLOW update, so `events` would replace the default map and drop
 * `m.room.power_levels`, `m.room.encryption`, `m.room.server_acl` (100) and
 * friends to `state_default`. Those defaults also vary by room version and
 * server config, so they cannot be restated here.
 *
 * Writes nothing when the room is already as asked. Throws on failure; the
 * caller decides whether that is fatal.
 */
export async function setMembersCanJoinCalls(matrix: MatrixClient, roomId: string, open: boolean): Promise<void> {
    const current = (await matrix.getStateEvent(roomId, EventType.RoomPowerLevels, "")) as PowerLevelsContent;
    const usersDefault = current.users_default ?? 0;
    const stateDefault = current.state_default ?? 50;
    const level = current.events?.[CALL_MEMBER_EVENT_TYPE] ?? stateDefault;
    if ((level <= usersDefault) === open) return;
    // Closed means moderators and up: at least 50, and never at or under the
    // default level (a room whose state_default is 0 would otherwise stay open).
    const target = open ? usersDefault : Math.max(stateDefault, 50, usersDefault + 1);
    await matrix.sendStateEvent(
        roomId,
        EventType.RoomPowerLevels,
        { ...current, events: { ...current.events, [CALL_MEMBER_EVENT_TYPE]: target } } as never,
        "",
    );
}
