import {
    ClientEvent,
    EventType,
    RoomMemberEvent,
    RoomStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    type SyncState,
    type SyncStateData,
} from "matrix-js-sdk";

import type { MemberView, RoomPowerLevelsView, Subscribable } from "../contract.ts";
import { Observable } from "../observable.ts";
import { fallbackName } from "./profile.ts";

/**
 * Moderation is the `m.room.power_levels` state event: reading it tells the UI
 * what it may do, and writing membership/power changes goes through the four
 * SDK helpers. This module owns both halves — the read helpers feed
 * `powerLevels()`/`banned()`, the writers are what the moderation dialogs
 * send. Contract-side shapes stay plain JSON; no SDK type leaks out.
 *
 * Permission is the server's to enforce. The `can*` flags here only spare the
 * user an obviously-doomed action; the server still rejects, and that
 * rejection surfaces honestly (the slice-20 rule).
 */

/** Spec defaults for a room with no (or a partial) power-levels event. */
const DEFAULTS = {
    usersDefault: 0,
    eventsDefault: 0,
    stateDefault: 50,
    ban: 50,
    kick: 50,
    redact: 50,
    invite: 0,
} as const;

/** The raw wire shape; every field is optional and untyped on the wire. */
interface PowerLevelsContent {
    users?: unknown;
    users_default?: unknown;
    events?: unknown;
    events_default?: unknown;
    state_default?: unknown;
    ban?: unknown;
    kick?: unknown;
    redact?: unknown;
    invite?: unknown;
}

/** A finite number or the spec default. */
function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Keep only the well-formed numeric entries of a `{ id: level }` map. */
function readLevelMap(value: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (!value || typeof value !== "object") return out;
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    }
    return out;
}

/**
 * Read a room's power levels off the live SDK object, applying spec defaults
 * for anything unset. `myPowerLevel` prefers the SDK's own effective member
 * level (which already folds `users` + `users_default`), falling back to the
 * raw content so an unloaded member still gets an honest number.
 */
export function snapshotPowerLevels(room: Room, selfId: string): RoomPowerLevelsView {
    const event = room.currentState.getStateEvents(EventType.RoomPowerLevels, "");
    const content = (event?.getContent() ?? {}) as PowerLevelsContent;
    const users = readLevelMap(content.users);
    const usersDefault = num(content.users_default, DEFAULTS.usersDefault);
    const stateDefault = num(content.state_default, DEFAULTS.stateDefault);
    const kick = num(content.kick, DEFAULTS.kick);
    const ban = num(content.ban, DEFAULTS.ban);
    const myPowerLevel = room.getMember(selfId)?.powerLevel ?? users[selfId] ?? usersDefault;
    return {
        users,
        usersDefault,
        eventsDefault: num(content.events_default, DEFAULTS.eventsDefault),
        stateDefault,
        ban,
        kick,
        redact: num(content.redact, DEFAULTS.redact),
        invite: num(content.invite, DEFAULTS.invite),
        events: readLevelMap(content.events),
        myPowerLevel,
        canKick: myPowerLevel >= kick,
        canBan: myPowerLevel >= ban,
        canSetPowerLevel: myPowerLevel >= stateDefault,
        canEditSettings: myPowerLevel >= stateDefault,
    };
}

/** Roster ordering, mirrored from `members.ts` so the banned list is stable. */
function byRosterOrder(a: MemberView, b: MemberView): number {
    return (
        b.powerLevel - a.powerLevel ||
        a.displayName.localeCompare(b.displayName, "en") ||
        a.userId.localeCompare(b.userId, "en")
    );
}

/** A banned member as the members pane needs it — no presence (nobody to poll), no trust lookup. */
function toBannedView(member: RoomMember, selfId: string): MemberView {
    return {
        userId: member.userId,
        displayName: fallbackName(member.userId, member.rawDisplayName),
        avatarUrl: member.getMxcAvatarUrl() || null,
        membership: "ban",
        powerLevel: member.powerLevel ?? 0,
        isSelf: member.userId === selfId,
        presence: "unknown",
        verification: "unknown",
        lastActiveTs: null,
    };
}

/**
 * Build the banned list for one room. Banned users are still `RoomMember`s —
 * they are filtered out of the roster by membership, not removed from the
 * room — which is exactly why this is a separate feed.
 */
export function snapshotBanned(room: Room, matrix: MatrixClient): MemberView[] {
    const selfId = matrix.getUserId();
    const out: MemberView[] = [];
    for (const member of room.getMembers()) {
        if (member.membership !== "ban") continue;
        out.push(toBannedView(member, selfId ?? ""));
    }
    out.sort(byRosterOrder);
    return out;
}

/**
 * Per-room power-levels feeds over one `MatrixClient`.
 *
 * The feed is an invalidation-signal reducer like the other trackers: the SDK
 * mutates state in place, so every relevant event (a change to
 * `m.room.power_levels`, a member's effective level, a membership change that
 * could remove the room) triggers a full recompute, with every sync as a
 * backstop. `RoomStateEvent.Events` is the precise signal for a threshold
 * change — `RoomMemberEvent.PowerLevel` misses it, because changing e.g.
 * `state_default` alters no member's own level.
 *
 * Same `Subscribable` per roomId on repeat calls (the `timeline()` rule).
 * `null` while the room is unknown.
 */
export class PowerLevelsTracker {
    private readonly matrix: MatrixClient;
    private readonly feeds = new Map<string, Observable<RoomPowerLevelsView | null>>();
    private readonly onRoomStateEvent: (event: MatrixEvent) => void;
    private readonly onMemberChange: (event: MatrixEvent, member: RoomMember) => void;
    private readonly onSync: (state: SyncState, prev: SyncState | null, data?: SyncStateData) => void;

    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.onRoomStateEvent = (event) => {
            const roomId = event.getRoomId();
            if (event.getType() === EventType.RoomPowerLevels && roomId) this.rebuild(roomId);
        };
        // Membership matters even though it carries no level: being kicked or
        // leaving makes the room (and so the view) go away.
        this.onMemberChange = (_event, member) => {
            if (member?.roomId) this.rebuild(member.roomId);
        };
        this.onSync = () => this.rebuildAll();
        this.matrix.on(RoomStateEvent.Events, this.onRoomStateEvent);
        this.matrix.on(RoomMemberEvent.PowerLevel, this.onMemberChange);
        this.matrix.on(RoomMemberEvent.Membership, this.onMemberChange);
        this.matrix.on(ClientEvent.Sync, this.onSync);
    }

    public powerLevels(roomId: string): Subscribable<RoomPowerLevelsView | null> {
        let feed = this.feeds.get(roomId);
        if (!feed) {
            feed = new Observable<RoomPowerLevelsView | null>(null);
            this.feeds.set(roomId, feed);
            this.rebuild(roomId);
        }
        return feed;
    }

    public detachAll(): void {
        this.matrix.removeListener(RoomStateEvent.Events, this.onRoomStateEvent);
        this.matrix.removeListener(RoomMemberEvent.PowerLevel, this.onMemberChange);
        this.matrix.removeListener(RoomMemberEvent.Membership, this.onMemberChange);
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        this.feeds.clear();
    }

    private rebuild(roomId: string): void {
        const feed = this.feeds.get(roomId);
        if (!feed) return;
        const room = this.matrix.getRoom(roomId);
        const selfId = this.matrix.getUserId();
        feed.set(room && selfId ? snapshotPowerLevels(room, selfId) : null);
    }

    private rebuildAll(): void {
        for (const roomId of this.feeds.keys()) this.rebuild(roomId);
    }
}

/** Kick `userId` from `roomId` (optional reason). Server enforces the power bar. */
export async function kickMember(
    matrix: MatrixClient,
    roomId: string,
    userId: string,
    reason?: string,
): Promise<void> {
    await matrix.kick(roomId, userId, reason);
}

/** Ban `userId` from `roomId` (optional reason). Server enforces the power bar. */
export async function banMember(
    matrix: MatrixClient,
    roomId: string,
    userId: string,
    reason?: string,
): Promise<void> {
    await matrix.ban(roomId, userId, reason);
}

/** Lift a ban. Membership returns to `leave`, so the user drops off `banned()`. */
export async function unbanMember(matrix: MatrixClient, roomId: string, userId: string): Promise<void> {
    await matrix.unban(roomId, userId);
}

/**
 * Set a member's explicit power level. The SDK writes the `users` override;
 * the server rejects when the caller is below the room's `state_default` or
 * at/below the target's level.
 */
export async function setMemberPowerLevel(
    matrix: MatrixClient,
    roomId: string,
    userId: string,
    powerLevel: number,
): Promise<void> {
    await matrix.setPowerLevel(roomId, userId, powerLevel);
}
