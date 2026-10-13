import { uploadWithRefresh } from "../util/token-refresh.ts";
import { EventType, type MatrixClient } from "matrix-js-sdk";
import {
    HistoryVisibility as SdkHistoryVisibility,
    JoinRule as SdkJoinRule,
} from "matrix-js-sdk/lib/@types/partials.js";

import type { HistoryVisibility, JoinRule, RoomSettingsPatch } from "../contract.ts";

/**
 * Settings live in state events (`m.room.name`/`topic`/`avatar`,
 * `m.room.join_rules`, `m.room.history_visibility`, `m.room.canonical_alias`),
 * so `snapshotRooms` reads them through the live `Room` object. This module
 * owns both halves: the read helpers feed the snapshot, the writer is what
 * the room-settings dialog sends. Both are kept SDK-free on the contract
 * side — the wire values below are string literals, never SDK enum members.
 */

interface SettingsReader {
    getJoinRule?(): unknown;
    getHistoryVisibility?(): unknown;
    getCanonicalAlias?(): string | null;
}

function toJoinRule(value: unknown): JoinRule {
    switch (value) {
        case "public":
        case "invite":
        case "knock":
        case "restricted":
            return value;
        default:
            // Missing `m.room.join_rules` defaults to invite-only.
            return "invite";
    }
}

function toHistoryVisibility(value: unknown): HistoryVisibility {
    switch (value) {
        case "shared":
        case "invited":
        case "joined":
        case "world_readable":
            return value;
        default:
            // Missing `m.room.history_visibility` defaults to shared.
            return "shared";
    }
}

/** Read a room's settings off the live SDK object, with spec defaults. */
export function readSettingsFields(room: SettingsReader): {
    joinRule: JoinRule;
    historyVisibility: HistoryVisibility;
    canonicalAlias: string | null;
} {
    // Accessors can throw on incomplete state (stubs and mid-sync rooms);
    // fall back to the spec default per field, never crash the snapshot.
    let joinRule: JoinRule = "invite";
    try {
        joinRule = toJoinRule(room.getJoinRule?.());
    } catch {
        joinRule = "invite";
    }
    let historyVisibility: HistoryVisibility = "shared";
    try {
        historyVisibility = toHistoryVisibility(room.getHistoryVisibility?.());
    } catch {
        historyVisibility = "shared";
    }
    let canonicalAlias: string | null = null;
    try {
        canonicalAlias = room.getCanonicalAlias?.() ?? null;
    } catch {
        canonicalAlias = null;
    }
    return { joinRule, historyVisibility, canonicalAlias };
}

/** Contract union → SDK enum for the state-event content. */
function toSdkJoinRule(rule: JoinRule): SdkJoinRule {
    switch (rule) {
        case "public":
            return SdkJoinRule.Public;
        case "knock":
            return SdkJoinRule.Knock;
        case "restricted":
            return SdkJoinRule.Restricted;
        case "invite":
            return SdkJoinRule.Invite;
    }
}

function toSdkHistoryVisibility(v: HistoryVisibility): SdkHistoryVisibility {
    switch (v) {
        case "invited":
            return SdkHistoryVisibility.Invited;
        case "joined":
            return SdkHistoryVisibility.Joined;
        case "world_readable":
            return SdkHistoryVisibility.WorldReadable;
        case "shared":
            return SdkHistoryVisibility.Shared;
    }
}

/**
 * Apply a settings patch. Only the fields present in `patch` are sent, each
 * independently: a mid-way failure leaves the earlier fields applied and the
 * later ones unset — the `rooms` feed shows exactly that, which is honest.
 * `null` clears (`topic`/`avatar` → empty state event, `canonicalAlias` →
 * an event with no alias), matching what `snapshotRooms` renders as absent.
 */
export async function updateRoomSettings(
    matrix: MatrixClient,
    roomId: string,
    patch: RoomSettingsPatch,
): Promise<void> {
    if (patch.name !== undefined) {
        await matrix.setRoomName(roomId, patch.name.trim());
    }
    if (patch.topic !== undefined) {
        // An empty body clears: the snapshot maps it back to `null`.
        await matrix.setRoomTopic(roomId, patch.topic === null ? "" : patch.topic.trim());
    }
    if (patch.avatar !== undefined) {
        if (patch.avatar === null) {
            await matrix.sendStateEvent(roomId, EventType.RoomAvatar, { url: "" });
        } else {
            const { content_uri } = await uploadWithRefresh(matrix, patch.avatar);
            await matrix.sendStateEvent(roomId, EventType.RoomAvatar, { url: content_uri });
        }
    }
    if (patch.joinRule !== undefined) {
        await matrix.sendStateEvent(roomId, EventType.RoomJoinRules, {
            join_rule: toSdkJoinRule(patch.joinRule),
        });
    }
    if (patch.historyVisibility !== undefined) {
        await matrix.sendStateEvent(roomId, EventType.RoomHistoryVisibility, {
            history_visibility: toSdkHistoryVisibility(patch.historyVisibility),
        });
    }
    if (patch.canonicalAlias !== undefined) {
        // An event without `alias` removes the canonical alias (spec).
        const content =
            patch.canonicalAlias === null || patch.canonicalAlias.trim() === ""
                ? {}
                : { alias: patch.canonicalAlias.trim() };
        await matrix.sendStateEvent(roomId, EventType.RoomCanonicalAlias, content);
    }
}