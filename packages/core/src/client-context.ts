import type { MatrixClient } from "matrix-js-sdk";

import type { AuthStorage, StoredSession } from "./auth/storage.ts";

/**
 * What a feature module (`rooms/profile-controller.ts`, …) may read from the
 * client that owns it. Type-only: `MatrixChatClient` builds the object in its
 * constructor body from closures over its own fields.
 *
 * Every getter is read AT CALL TIME. A feature never caches the client it got
 * from `matrix()`: the lifecycle swaps it (null before start, a fresh one per
 * start, null again after stop), and stale-client guards such as
 * `ctx.matrix() === client` after an await depend on reading it live.
 */
export interface ClientContext {
    readonly storage: AuthStorage;
    /** The running client, or null before start() / after stop(). */
    matrix(): MatrixClient | null;
    /** The adopted session, or null when logged out. */
    session(): StoredSession | null;
    /** The room the UI is showing (setRoomSelection), or null. */
    selectedRoomId(): string | null;
}
