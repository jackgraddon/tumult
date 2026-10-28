import type { MemberView, VoiceView } from "@tumult/core";

/** One person in a room's call, as the strip draws them. */
export interface CallStripPerson {
    userId: string;
    name: string;
    avatarUrl: string | null;
    /** Only known while we are in the session ourselves (the SFU tells us). */
    speaking: boolean;
    muted: boolean;
    isSelf: boolean;
}

/** What the strip above a room's timeline shows, or `null` for no strip. */
export interface CallStrip {
    /** We are in this room's session (connecting counts: the button is Leave). */
    joined: boolean;
    state: VoiceView["state"] | null;
    people: CallStripPerson[];
}

/**
 * Who is in `roomId`'s call, derived from the three feeds the shell already
 * holds. While we are in the session the SFU's view (`voice.participants`) is
 * the honest one — it carries speaking/mute. Otherwise only the room's call
 * memberships (`voiceRooms`) exist, so speaking/mute are unknown and drawn as
 * false. Either source lists devices; the strip shows people, so a user on two
 * devices appears once (speaking/muted if any device is).
 */
export function buildCallStrip(
    roomId: string,
    voice: VoiceView | null,
    voiceRooms: Record<string, string[]>,
    members: readonly MemberView[],
    selfId: string | null,
): CallStrip | null {
    const joined = voice?.roomId === roomId;
    const byId = new Map(members.map((member) => [member.userId, member]));
    const people = new Map<string, CallStripPerson>();

    const add = (userId: string, speaking: boolean, muted: boolean): void => {
        const existing = people.get(userId);
        if (existing) {
            existing.speaking ||= speaking;
            existing.muted &&= muted;
            return;
        }
        const member = byId.get(userId);
        people.set(userId, {
            userId,
            name: member?.displayName ?? localpart(userId),
            avatarUrl: member?.avatarUrl ?? null,
            speaking,
            muted,
            isSelf: userId === selfId,
        });
    };

    if (joined && voice.participants.length > 0) {
        for (const p of voice.participants) add(p.userId, p.speaking, p.muted);
    } else {
        for (const userId of voiceRooms[roomId] ?? []) add(userId, false, false);
    }

    if (!joined && people.size === 0) return null;
    return { joined, state: joined ? voice.state : null, people: [...people.values()] };
}

function localpart(userId: string): string {
    return userId.replace(/^@/, "").split(":")[0] ?? userId;
}
