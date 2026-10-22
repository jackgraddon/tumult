import type { MatrixClient } from "matrix-js-sdk";

import type { OwnPresenceView } from "../contract.ts";

/**
 * Read our own presence + status message.
 *
 * Presence is user-level server state, not part of the profile, so this is a
 * separate read from `readProfile`: `GET /presence/:userId/status`. The status
 * message lives here too — it is `m.presence`'s `status_msg`, which no profile
 * endpoint carries.
 *
 * A server that has presence disabled rejects; callers must keep their last
 * snapshot rather than claiming the status was cleared.
 */
export async function readOwnPresence(matrix: MatrixClient): Promise<OwnPresenceView> {
    const userId = matrix.getUserId();
    if (!userId) throw new Error("No session");
    const status = await matrix.getPresence(userId);
    return {
        presence: status.presence,
        // `status_msg` is absent when unset — never invent an empty message.
        statusMessage: status.status_msg ? status.status_msg : null,
    };
}
