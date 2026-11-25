/**
 * The shell-owned Activity controller.
 *
 * The released Rich Presence plugin used last-write-wins on one profile field:
 * a native push and a manual edit wrote the same document, so a manual clear
 * was overwritten by the next RPC event. This controller makes the precedence
 * explicit instead: while a native feed has an activity, that is what is
 * published; the user's manual document is held as a draft and restored when
 * the native source clears. It owns `app.tumult.activity` for every renderer,
 * so web and desktop share one surface and one schema.
 */

import { reportError } from "@tumult/core/errors";
import { inject, ref, shallowRef, type InjectionKey, type Ref, type ShallowRef } from "vue";
import type { ChatClient, OwnActivityView, OwnPresenceState, Subscription } from "@tumult/core";

import type { Disposable, NativeActivityFeed } from "../plugins/types.ts";
import {
    ACTIVITY_FIELD_KEY,
    activityFromNative,
    activityStatusText,
    createActivity,
    parseActivity,
    sameActivity,
    type ActivityDocument,
    type ActivityInput,
} from "./document.ts";

export type ActivitySource = "none" | "manual" | "native";

const DRAFT_KEY = "cc.jackg.tumult.activity.draft";
const PREFS_KEY = "cc.jackg.tumult.activity.prefs";

interface Prefs {
    mirror: boolean;
    lastMirrored: string | null;
}

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function readJson(key: string): unknown {
    const store = storage();
    if (!store) return null;
    try {
        const raw = store.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode / quota: the in-memory state still works this session.
    }
}

export class ActivityController {
    /** What is currently published (or would be, if profile fields were off). */
    public readonly current: ShallowRef<ActivityDocument | null> = shallowRef(null);
    /** The live native activity, before precedence is applied. */
    public readonly native: ShallowRef<ActivityDocument | null> = shallowRef(null);
    /** The user's manual document, held but not published while native is live. */
    public readonly draft: ShallowRef<ActivityDocument | null> = shallowRef(null);
    public readonly source: Ref<ActivitySource> = ref("none");
    /** `null` until the homeserver has answered — false is a real answer. */
    public readonly supported: Ref<boolean | null> = ref(null);
    public readonly error: Ref<string> = ref("");
    public readonly mirror: Ref<boolean> = ref(true);

    private readonly client: ChatClient;
    private readonly feed: NativeActivityFeed;
    private userId: string | null = null;
    private subscriptions: Disposable[] = [];
    private profileSubscription: Subscription | null = null;
    private ownSubscription: Subscription | null = null;
    private chain: Promise<void> = Promise.resolve();
    private supportCheck: Promise<void> | null = null;
    private generation = 0;
    private stopped = true;
    /**
     * A document we intend to publish but could not yet. `fieldDirty` waits on
     * MSC4133 support; `accountDirty` waits on `startClient()`. Both are
     * retried when their precondition arrives instead of being dropped.
     */
    private fieldDirty = false;
    private accountDirty = false;
    /** The last document we tried to make canonical on both channels. */
    private lastPublished: ActivityDocument | null = null;
    /**
     * The account-data document we consider canonical. `undefined` means no
     * answer yet; `null` is an explicit clear. It wins over the slower public
     * profile field for this user's own display, and is set to the intended
     * document before a local write so that write's field echo is not read
     * back as a stale remote value.
     */
    private ownActivityDoc: ActivityDocument | null | undefined;
    /** The last document observed from ANOTHER device on this account. */
    private remoteDocument: ActivityDocument | null | undefined;
    /** Writes queued but not settled; dirty retries must not duplicate them. */
    private pendingPublishes = 0;
    /** Our device id, used to tell a Sync echo of our own write from a remote one. */
    private ownDeviceId = "";
    /** `undefined` means no mirror is in flight; `null` means a clear is. */
    private pendingMirror: string | null | undefined;
    private lastMirrored: string | null = null;
    private prefs: Prefs = { mirror: true, lastMirrored: null };

    public constructor(client: ChatClient, feed: NativeActivityFeed) {
        this.client = client;
        this.feed = feed;
    }

    private get userKey(): string {
        return `${this.userId ?? "anonymous"}:`;
    }

    private stale(generation: number, userId: string): boolean {
        return this.stopped || this.generation !== generation || this.userId !== userId;
    }

    /** Start for one signed-in user; a second start replaces the first. */
    public async start(userId: string): Promise<void> {
        this.stop();
        const generation = ++this.generation;
        this.stopped = false;
        this.userId = userId;
        this.error.value = "";
        // The client adopts its session BEFORE startClient(); a support check
        // made now would answer false and stay false forever.
        this.supported.value = null;
        this.fieldDirty = false;
        this.accountDirty = false;
        this.ownActivityDoc = undefined;
        this.remoteDocument = undefined;
        this.pendingPublishes = 0;
        this.ownDeviceId = this.client.session.get()?.deviceId ?? "";
        this.pendingMirror = undefined;
        const storedPrefs = readJson(this.userKey + PREFS_KEY);
        if (storedPrefs && typeof storedPrefs === "object") {
            const raw = storedPrefs as Record<string, unknown>;
            this.prefs = {
                mirror: typeof raw["mirror"] === "boolean" ? raw["mirror"] : true,
                lastMirrored: typeof raw["lastMirrored"] === "string" ? raw["lastMirrored"] : null,
            };
        } else {
            this.prefs = { mirror: true, lastMirrored: null };
        }
        this.mirror.value = this.prefs.mirror;
        this.lastMirrored = this.prefs.lastMirrored;
        this.draft.value = parseActivity(readJson(this.userKey + DRAFT_KEY));

        // Subscribe to NATIVE FIRST. The native feed delivers its current value
        // at subscription time; if a profile field already holds that activity,
        // reading it first would mistake it for the user's manual draft.
        let previous: ActivityDocument | null | undefined;
        this.subscriptions.push(
            this.feed.subscribe((value) => {
                const next = value ? activityFromNative(value) : null;
                if (previous !== undefined && sameActivity(previous, next)) return;
                const first = previous === undefined;
                previous = next;
                this.native.value = next;
                if (!first || next) {
                    if (next) {
                        void this.publish(next, "native");
                    } else {
                        // A manual edit made on another device is the last
                        // server-side document we saw; restore that, and only
                        // fall back to this device's draft when there was none.
                        const restore = this.remoteDocument !== undefined ? this.remoteDocument : this.draft.value;
                        void this.publish(restore, restore ? "manual" : "none");
                    }
                }
            }),
        );

        // The private, sync-fed copy is authoritative for our OWN display: it
        // reaches this device from another device on the next sync, while the
        // public field is a cached REST read. Subscribe before the connection
        // check so a value already in the SDK's store is adopted immediately.
        const ownFeed = this.client.ownActivity;
        this.reconcileOwnActivity(ownFeed.get(), generation, userId);
        this.ownSubscription = ownFeed.subscribe((value) => {
            this.reconcileOwnActivity(value, generation, userId);
        });

        // Profile-field support becomes true only once the Matrix client is
        // started. The connection feed is also the honest signal for retrying
        // an account-data write that arrived too early.
        const connection = this.client.connection.subscribe(() => {
            // Wait for the support answer before retrying: a queued manual
            // write must be published to BOTH channels in one pass, not write
            // account data while support is still unknown and field later.
            void this.ensureSupport(generation, userId).then(() => this.flushDirty(generation, userId));
        });
        this.subscriptions.push(() => connection.unsubscribe());
        void this.ensureSupport(generation, userId);

        const presence = this.client.ownPresence.subscribe(() => {
            const message = this.client.ownPresence.get()?.statusMessage ?? "";
            // Our own setOwnPresence() publishes synchronously. Ignore that
            // echo, and never claim a status the user typed as one we own.
            if (this.pendingMirror !== undefined && message === this.pendingMirror) return;
            if (message === "" || message === this.lastMirrored) return;
            this.lastMirrored = null;
            this.prefs.lastMirrored = null;
            writeJson(this.userKey + PREFS_KEY, this.prefs);
        });
        this.subscriptions.push(() => presence.unsubscribe());
    }

    private ensureSupport(generation: number, userId: string): Promise<void> {
        if (this.stale(generation, userId) || this.supported.value === true) return Promise.resolve();
        if (this.supportCheck) return this.supportCheck;
        const state = this.client.connection.get();
        if (state === "starting" || state === "stopped") return Promise.resolve();

        const task = (async () => {
            const supported = await this.client.profileFieldsSupported().catch(() => false);
            if (this.stale(generation, userId)) return;
            this.supported.value = supported;
            if (supported) this.attachProfileField(generation, userId);
        })();
        this.supportCheck = task;
        void task.finally(() => {
            if (this.supportCheck === task) this.supportCheck = null;
        });
        return task;
    }

    private attachProfileField(generation: number, userId: string): void {
        if (this.profileSubscription || this.stale(generation, userId)) return;
        const feed = this.client.profileField(userId, ACTIVITY_FIELD_KEY);
        // Unlike the native feed, a core Subscribable does NOT deliver at
        // subscribe time: it is lazy and fires when its first fetch lands.
        this.reconcileField(parseActivity(feed.get()), generation);
        this.profileSubscription = feed.subscribe((value) => {
            this.reconcileField(parseActivity(value), generation);
        });
    }

    /**
     * Account data is the private, sync-fed copy for this account. A write we
     * made comes back through Sync too; matching device + stamp is our echo and
     * must not be mistaken for a manual edit from another device.
     */
    private reconcileOwnActivity(view: OwnActivityView | null, generation: number, userId: string): void {
        if (this.stale(generation, userId)) return;
        if (!view) {
            // stop()/logout resets the feed. Keep the last document as the
            // restore candidate; only the feed's presence is gone.
            this.ownActivityDoc = undefined;
            return;
        }
        const parsed = parseActivity(view.document);
        // The writer's device id is the honest echo marker: Sync publishes our
        // setOwnActivity() call back to us, but another device's write is the
        // one that should become the restore point after native activity ends.
        const remote = this.ownDeviceId === "" || view.deviceId !== this.ownDeviceId;
        if (remote) this.remoteDocument = parsed;
        this.ownActivityDoc = parsed;
        if (this.native.value) {
            // Native still wins, including against a manual edit from another
            // device. Force a rewrite so the other device learns that too.
            if (!sameActivity(parsed, this.native.value)) void this.publish(this.native.value, "native", true);
            return;
        }
        this.adoptDocument(parsed, generation, false);
    }

    /** Retry a write that was queued before the client (or profile support) was ready. */
    private flushDirty(generation: number, userId: string): void {
        if (this.stale(generation, userId) || (!this.fieldDirty && !this.accountDirty)) return;
        if (this.pendingPublishes > 0) return;
        const document = this.native.value ?? this.draft.value;
        void this.publish(document, this.native.value ? "native" : document ? "manual" : "none", true);
    }

    private reconcileField(parsed: ActivityDocument | null, generation: number): void {
        if (this.stopped || this.generation !== generation) return;
        if (this.native.value) {
            // A plugin or another client tried to write the field while a
            // producer is live. Force a rewrite: the normal short-circuit on
            // an unchanged document would otherwise make this a no-op.
            if (!sameActivity(parsed, this.native.value)) void this.publish(this.native.value, "native", true);
            return;
        }
        // Account data reaches our own devices on sync; the public field can
        // be minutes stale. Once account data has answered, it is the source
        // of truth and the field is rewritten if another surface lags behind.
        // While a write is already queued its field echo has not landed yet —
        // that is not a lag to correct, but the same write in flight.
        if (
            this.pendingPublishes === 0 &&
            this.ownActivityDoc !== undefined &&
            !sameActivity(parsed, this.ownActivityDoc)
        ) {
            void this.publish(this.ownActivityDoc, this.ownActivityDoc ? "manual" : "none", true);
            return;
        }
        // A dirty draft was accepted locally while profile fields were still
        // unavailable. An empty field is not an explicit clear in that case.
        if (this.fieldDirty && this.draft.value && !parsed) {
            if (this.pendingPublishes === 0) void this.publish(this.draft.value, "manual");
            return;
        }
        // A public-field read is not a cross-device signal: our own writes echo
        // here too. It only refreshes the draft; `remoteDocument` is reserved
        // for account data written by a different device.
        this.adoptDocument(parsed, generation, true);
    }

    /** Adopt a server-side document as this user's manual draft and display. */
    private adoptDocument(document: ActivityDocument | null, generation: number, fieldPublished: boolean): void {
        const previous = this.current.value;
        if (!sameActivity(document, this.draft.value)) {
            this.draft.value = document;
            writeJson(this.userKey + DRAFT_KEY, document);
        }
        if (fieldPublished) {
            this.lastPublished = document;
            this.fieldDirty = false;
        }
        this.current.value = document;
        this.source.value = document ? "manual" : "none";
        if (!sameActivity(document, previous)) this.queueMirror(document, generation);
    }

    /** Tear down this user's subscriptions; a later start reloads their draft. */
    public stop(): void {
        this.generation += 1;
        this.stopped = true;
        for (const dispose of this.subscriptions) dispose();
        this.subscriptions = [];
        this.profileSubscription?.unsubscribe();
        this.profileSubscription = null;
        this.ownSubscription?.unsubscribe();
        this.ownSubscription = null;
        this.supportCheck = null;
        this.native.value = null;
        this.current.value = null;
        this.source.value = "none";
        this.supported.value = null;
        this.error.value = "";
        this.fieldDirty = false;
        this.accountDirty = false;
        this.ownActivityDoc = undefined;
        this.remoteDocument = undefined;
        this.pendingPublishes = 0;
        this.ownDeviceId = "";
        this.pendingMirror = undefined;
        this.lastPublished = null;
    }

    /** Save (or clear) the manual document. Native wins until it clears. */
    public async setManual(input: ActivityInput | null): Promise<void> {
        this.error.value = "";
        const document = input ? createActivity(input) : null;
        this.draft.value = document;
        writeJson(this.userKey + DRAFT_KEY, document);
        if (this.native.value) return;
        await this.publish(document, document ? "manual" : "none");
        if (this.error.value === "") return;
        // A failed profile-field write is an error, not a saved success. The
        // draft is kept so the user can retry after fixing the connection.
        throw new Error(this.error.value);
    }

    public setMirror(enabled: boolean): void {
        const was = this.mirror.value;
        this.mirror.value = enabled;
        this.prefs.mirror = enabled;
        writeJson(this.userKey + PREFS_KEY, this.prefs);
        // `mirrorActivity` refuses while the toggle is off, so clear BEFORE
        // flipping it. A status the user wrote themselves is never ours.
        if (was && !enabled && this.lastMirrored !== null) {
            const generation = this.generation;
            this.chain = this.chain.then(() => this.clearMirroredStatus(generation));
        }
    }

    private publish(document: ActivityDocument | null, source: ActivitySource, force = false): Promise<void> {
        const userId = this.userId;
        const generation = this.generation;
        if (!userId) return Promise.resolve();
        this.pendingPublishes += 1;
        const task = this.chain.then(async () => {
            if (this.stale(generation, userId)) return;
            if (source === "manual" && this.native.value) return;
            // `lastPublished` is only a short-circuit once BOTH channels are
            // clean. A queued write (support/client not ready) must retry.
            if (
                !force &&
                !this.fieldDirty &&
                !this.accountDirty &&
                sameActivity(document, this.lastPublished) &&
                source !== "none"
            ) {
                this.current.value = document;
                this.source.value = source;
                return;
            }
            this.error.value = "";
            let fieldWrote = false;
            let ownWrote = false;
            // Make the intended document authoritative before writing either
            // channel: setProfileField() publishes its own echo synchronously,
            // and that echo must not be read back as a stale remote field.
            this.ownActivityDoc = document;

            // The public field is how OTHER users see us. Its failure is
            // reported, but must not stop the private sync-fed copy below.
            if (this.supported.value) {
                try {
                    await this.client.setProfileField(ACTIVITY_FIELD_KEY, document);
                    fieldWrote = true;
                } catch (error) {
                    this.error.value = reportError(error, "Couldn't update your activity");
                }
            }
            if (this.stale(generation, userId)) return;

            // Account data is how our OWN devices see us immediately. Before
            // startClient() it cannot be written; the connection watcher
            // retries it instead of silently dropping the document.
            const state = this.client.connection.get();
            if (state === "starting" || state === "stopped") {
                this.accountDirty = true;
            } else {
                try {
                    await this.client.setOwnActivity(document);
                    ownWrote = true;
                    this.ownActivityDoc = document;
                } catch (error) {
                    if (this.error.value === "") this.error.value = reportError(error, "Couldn't sync your activity");
                }
            }
            if (this.stale(generation, userId)) return;

            this.lastPublished = document;
            this.fieldDirty = this.supported.value !== false && !fieldWrote;
            this.accountDirty = !ownWrote;
            this.current.value = document;
            this.source.value = source;
            await this.mirrorActivity(document, generation);
        });
        this.chain = task.finally(() => {
            // A stale chain belongs to a previous start(), which already reset
            // the counter; it must not decrement the new generation's count.
            if (!this.stale(generation, userId)) this.pendingPublishes -= 1;
        });
        return this.chain;
    }

    private queueMirror(document: ActivityDocument | null, generation: number): void {
        this.chain = this.chain.then(() => this.mirrorActivity(document, generation));
    }

    /** Mirror a plain-text line for homeservers/clients without rich activity. */
    private async mirrorActivity(document: ActivityDocument | null, generation: number): Promise<void> {
        if (!this.mirror.value || this.stale(generation, this.userId ?? "")) return;
        const presence = this.client.ownPresence.get();
        // Presence is user-level state; inventing "online" here would overwrite
        // a choice made on another client before our first read landed.
        if (!presence) return;
        const message = presence.statusMessage ?? "";
        const wanted = document ? activityStatusText(document) : null;

        if (message === wanted && wanted !== null) {
            // Only take ownership of an echo from a write WE made. A status the
            // user typed with the same words is still theirs.
            if (this.pendingMirror === wanted) this.saveMirrored(wanted);
            return;
        }
        if (message === "" && wanted === null) {
            this.saveMirrored(null);
            return;
        }
        if (message !== "" && message !== this.lastMirrored) return;

        // Claim ownership BEFORE the write: core publishes the new snapshot
        // synchronously, and our own listener must see this as our echo.
        const previous = this.lastMirrored;
        this.pendingMirror = wanted;
        this.saveMirrored(wanted);
        try {
            await this.client.setOwnPresence(presence.presence as OwnPresenceState, wanted ?? undefined);
            if (this.stale(generation, this.userId ?? "")) return;
            this.saveMirrored(wanted);
        } catch (error) {
            this.saveMirrored(previous);
            this.error.value = reportError(error, "Couldn't update your status");
        } finally {
            if (this.pendingMirror === wanted) this.pendingMirror = undefined;
        }
    }

    private async clearMirroredStatus(generation: number): Promise<void> {
        const presence = this.client.ownPresence.get();
        if (!presence) return;
        const message = presence.statusMessage ?? "";
        if (message !== "" && message !== this.lastMirrored) return;
        const previous = this.lastMirrored;
        this.pendingMirror = null;
        this.saveMirrored(null);
        try {
            await this.client.setOwnPresence(presence.presence as OwnPresenceState, undefined);
            if (this.stale(generation, this.userId ?? "")) return;
        } catch (error) {
            this.saveMirrored(previous);
            this.error.value = reportError(error, "Couldn't clear your status");
        } finally {
            if (this.pendingMirror === null) this.pendingMirror = undefined;
        }
    }

    private saveMirrored(value: string | null): void {
        this.lastMirrored = value;
        this.prefs.lastMirrored = value;
        writeJson(this.userKey + PREFS_KEY, this.prefs);
    }
}

export const ActivityControllerKey: InjectionKey<ActivityController> = Symbol("tumult/activity-controller");

export function useActivityController(): ActivityController {
    const found = inject(ActivityControllerKey);
    if (!found) throw new Error("useActivityController() requires TumultShell above it.");
    return found;
}
