import { ClientEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

import type { OwnActivityView } from "../contract.ts";
import type { ClientContext } from "../client-context.ts";
import { Observable } from "../observable.ts";

/**
 * User-level account data carrying our rich activity document. Unlike an
 * extended-profile field (a cached REST read), global account data comes down
 * the sync stream to EVERY device on the account — including under simplified
 * sliding sync, whose account-data extension emits `ClientEvent.AccountData`.
 *
 * Keep it separate from the public `app.tumult.activity` profile field: account
 * data is private to the account, while that field is what other users render.
 */
export const OWN_ACTIVITY_KEY = "app.tumult.activity.state";

/** Bounded so a hostile or broken client cannot park a huge document in memory. */
const MAX_DOCUMENT_JSON = 16_000;
const MAX_DEVICE_ID = 256;

interface AccountDataReader {
    getAccountData(type: string): { getContent(): Record<string, unknown> } | undefined;
    setAccountDataRaw(type: string, content: Record<string, unknown>): Promise<unknown>;
}

/** SDK account-data methods are keyed by known event types; our key is namespaced. */
function asAccountData(client: MatrixClient): AccountDataReader {
    return client as unknown as AccountDataReader;
}

/**
 * Validate the envelope, not the document: the UI owns the activity schema and
 * its parser. A malformed or oversized event is ignored rather than rendered —
 * account data is writable by any device on this account.
 */
export function parseOwnActivity(value: unknown): OwnActivityView | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw["v"] !== 1) return null;
    const updatedAt = raw["updatedAt"];
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
    const deviceId = raw["deviceId"];
    if (typeof deviceId !== "string" || deviceId.length === 0 || deviceId.length > MAX_DEVICE_ID) return null;
    const document = raw["document"];
    if (document !== null && (typeof document !== "object" || Array.isArray(document))) return null;
    if (document !== null && JSON.stringify(document).length > MAX_DOCUMENT_JSON) return null;
    return { document: document ?? null, updatedAt, deviceId };
}

/**
 * The owned-activity feed is created once and lives for the client's whole
 * life, like OwnPresenceController. It listens on the client passed to start()
 * and is reset on stop — but logout never DELETES the account data: it is the
 * account's canonical status, shared with the user's other devices.
 */
export class OwnActivityController {
    public readonly feed = new Observable<OwnActivityView | null>(null);

    private readonly ctx: ClientContext;
    private detachListener: (() => void) | null = null;
    private lastUpdatedAt = 0;

    public constructor(ctx: ClientContext) {
        this.ctx = ctx;
    }

    public start(client: MatrixClient): void {
        this.stop();
        this.read(client);
        const listener = (event: MatrixEvent): void => {
            if (event.getType() !== OWN_ACTIVITY_KEY) return;
            this.feed.set(parseOwnActivity(event.getContent()));
        };
        client.on(ClientEvent.AccountData, listener);
        this.detachListener = () => client.off(ClientEvent.AccountData, listener);
    }

    public stop(): void {
        this.detachListener?.();
        this.detachListener = null;
        this.feed.set(null);
    }

    public async set(document: unknown | null): Promise<void> {
        const client = this.ctx.matrix();
        if (!client) throw new Error("Cannot set activity before start()");
        // Two writes in the same millisecond must still order deterministically.
        const updatedAt = Math.max(Date.now(), this.lastUpdatedAt + 1);
        const deviceId = this.ctx.session()?.deviceId ?? "";
        const view: OwnActivityView = { document: document ?? null, updatedAt, deviceId };
        // Raw: setAccountData() waits for the sync echo, which can lag behind a
        // slow sync loop. The HTTP ack is enough; our own feed is published
        // locally and the echo is filtered by device id + timestamp.
        await asAccountData(client).setAccountDataRaw(OWN_ACTIVITY_KEY, {
            v: 1,
            document: view.document,
            updatedAt,
            deviceId,
        });
        this.lastUpdatedAt = updatedAt;
        this.feed.set(view);
    }

    private read(client: MatrixClient): void {
        const event = asAccountData(client).getAccountData(OWN_ACTIVITY_KEY);
        const view = event ? parseOwnActivity(event.getContent()) : null;
        this.feed.set(view);
        if (view) this.lastUpdatedAt = view.updatedAt;
    }
}
