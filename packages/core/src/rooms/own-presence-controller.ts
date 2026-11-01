import { UserEvent } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

import type { OwnPresenceState, OwnPresenceView } from "../contract.ts";
import type { ClientContext } from "../client-context.ts";
import { Observable } from "../observable.ts";
import { ThrottledTask } from "../util/throttle.ts";
import { readOwnPresence } from "./own-presence.ts";

/**
 * The presence the user last chose (`online` when never set). Re-asserted on
 * start and on {@link OWN_PRESENCE_HEARTBEAT_MS}: sliding sync carries no
 * `set_presence`, so without this the server never hears we are online and
 * keeps reporting `offline` while we are plainly using the app.
 */
export const PRESENCE_KEY = "tumult.presence.desired";

/**
 * How often our own presence is re-read and, if the server drifted (idle
 * timeout, another client), re-asserted. Also how fast a status set on
 * another device reaches the bar under sliding sync. One GET per tick.
 */
export const OWN_PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * Coalesce window for our own presence. Presence for one user can arrive as a
 * burst of `m.presence` events (a status change plus a last-active bump), and
 * each refresh is a REST read; one read per window is enough for a status line.
 */
export const OWN_PRESENCE_REFRESH_MS = 250;

/**
 * Our own presence + status message: the feed, the heartbeat that re-asserts
 * the user's choice, and the coalesced re-read on `m.presence`.
 *
 * The feed is created once and lives for the client's whole life. It stays
 * `null` until the server tells us — presence is user-level state, not
 * something we can infer from the profile, and a fresh session has no honest
 * answer yet.
 */
export class OwnPresenceController {
    public readonly feed = new Observable<OwnPresenceView | null>(null);

    private readonly ctx: ClientContext;
    /** The heartbeat interval, alive while the sync loop runs. */
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    /** Coalesces `m.presence` bursts for our own user into one read. */
    private readonly refreshTask: ThrottledTask;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(ctx: ClientContext) {
        this.ctx = ctx;
        this.refreshTask = new ThrottledTask(() => {
            void this.refresh();
        }, OWN_PRESENCE_REFRESH_MS);
    }

    /**
     * Read our presence now and re-assert the presence the user chose (sliding
     * sync never tells the server we are here), then keep it honest on a
     * heartbeat. `m.presence` (classic sync) and our own writes refresh it in
     * between; under sliding sync a status set by ANOTHER client lands on the
     * next heartbeat. Registers its listener on the client passed in.
     */
    public start(client: MatrixClient): void {
        void this.announce();
        this.heartbeat = setInterval(() => void this.announce(), OWN_PRESENCE_HEARTBEAT_MS);
        const selfId = client.getUserId();
        client.on(UserEvent.Presence, (_event, user) => {
            if (user.userId !== selfId) return;
            this.refreshTask.schedule();
        });
    }

    /** Stop the heartbeat and drop a pending re-read. Idempotent. */
    public stop(): void {
        this.refreshTask.clear();
        if (this.heartbeat !== null) clearInterval(this.heartbeat);
        this.heartbeat = null;
    }

    /** Forget the user's chosen presence (account-scoped; logout). */
    public forget(): void {
        this.ctx.storage.removeItem(PRESENCE_KEY);
    }

    public async set(presence: OwnPresenceState, statusMessage?: string): Promise<void> {
        const client = this.ctx.matrix();
        if (!client) throw new Error("Cannot set presence before start()");
        await client.setPresence(statusMessage === undefined ? { presence } : { presence, status_msg: statusMessage });
        // Remember the choice: start and the heartbeat re-assert it.
        this.ctx.storage.setItem(PRESENCE_KEY, presence);
        // The server accepted the write, so publish it immediately — the bar
        // must not sit on a stale status while a follow-up read is in flight.
        // The read then corrects anything the server normalised.
        this.feed.set({
            presence,
            statusMessage: statusMessage !== undefined && statusMessage.trim() !== "" ? statusMessage : null,
        });
        void this.refresh();
    }

    /**
     * Publish our own presence + status message. Never throws: presence can be
     * disabled on the homeserver, and a failed read is not evidence the status
     * was cleared — the last snapshot stays.
     */
    public async refresh(): Promise<void> {
        const client = this.ctx.matrix();
        if (!client) return;
        try {
            this.feed.set(await readOwnPresence(client));
        } catch (error) {
            console.error("[tumult] own presence snapshot failed", error);
        }
    }

    /**
     * Read our presence and, when the server disagrees with what the user
     * chose, write the choice back (keeping the current status message).
     * Publishes whichever the server ends up holding. Never throws: a server
     * with presence disabled keeps the last snapshot, as in refresh().
     */
    public async announce(): Promise<void> {
        const client = this.ctx.matrix();
        if (!client) return;
        try {
            const current = await readOwnPresence(client);
            const desired = this.ctx.storage.getItem<OwnPresenceState>(PRESENCE_KEY) ?? "online";
            if (current.presence !== desired && this.ctx.matrix() === client) {
                await client.setPresence(
                    current.statusMessage === null
                        ? { presence: desired }
                        : { presence: desired, status_msg: current.statusMessage },
                );
                current.presence = desired;
            }
            if (this.ctx.matrix() === client) this.feed.set(current);
        } catch (error) {
            console.error("[tumult] own presence announce failed", error);
        }
    }
}
