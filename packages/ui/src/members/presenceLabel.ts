import type { MemberView } from "@tumult/core/contract";

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago" from an absolute time.
 *
 * Shared by the member row and the profile card so the two never disagree
 * about how long ago someone was last seen.
 */
export function ago(ts: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

/**
 * One honest sentence about a member's presence.
 *
 * `unknown` is a first-class answer: presence only becomes real once the server
 * has told us this session (see `MembersTracker`), so guessing `offline` here
 * would turn "we have not heard yet" into a claim about the person.
 */
export function presenceLabel(member: MemberView): string {
    if (member.presence === "online") return "Online";
    if (member.presence === "unavailable") return "Away";
    if (member.presence === "offline") {
        return member.lastActiveTs ? `Last seen ${ago(member.lastActiveTs)}` : "Offline";
    }
    return "Presence not yet known";
}
