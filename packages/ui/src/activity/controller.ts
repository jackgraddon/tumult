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
import type { ChatClient, OwnPresenceState, Subscription } from "@tumult/core";

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
    private chain: Promise<void> = Promise.resolve();
    private supportCheck: Promise<void> | null = null;
    private generation = 0;
    private stopped = true;
    /**
     * A document we intend to publish but could not yet — profile fields are
     * unavailable before `startClient()`. Once support arrives it is written,
     * unless the field meanwhile showed an explicit clear from another client.
     */
    private fieldDirty = false;
    private lastPublished: ActivityDocument | null = null;
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
                    if (next) void this.publish(next, "native");
                    else void this.publish(this.draft.value, this.draft.value ? "manual" : "none");
                }
            }),
        );

        // Profile-field support becomes true only once the Matrix client is
        // started. The connection feed is the honest signal for when to retry;
        // a transient false must not disable publishing for the whole session.
        const connection = this.client.connection.subscribe(() => {
            void this.ensureSupport(generation, userId);
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

    private reconcileField(parsed: ActivityDocument | null, generation: number): void {
        if (this.stopped || this.generation !== generation) return;
        if (this.native.value) {
            // A plugin or another client tried to write the field while a
            // producer is live. Force a rewrite: the normal short-circuit on
            // an unchanged document would otherwise make this a no-op.
            if (!sameActivity(parsed, this.native.value)) void this.publish(this.native.value, "native", true);
            return;
        }
        // A dirty draft was accepted locally while profile fields were still
        // unavailable. An empty field is not an explicit clear in that case.
        if (this.fieldDirty && this.draft.value && !parsed) {
            void this.publish(this.draft.value, "manual");
            return;
        }
        const previousPublished = this.lastPublished;
        if (!sameActivity(parsed, this.draft.value)) {
            this.draft.value = parsed;
            writeJson(this.userKey + DRAFT_KEY, parsed);
        }
        this.lastPublished = parsed;
        this.fieldDirty = false;
        this.current.value = parsed;
        this.source.value = parsed ? "manual" : "none";
        if (!sameActivity(parsed, previousPublished)) this.queueMirror(parsed, generation);
    }

    /** Tear down this user's subscriptions; a later start reloads their draft. */
    public stop(): void {
        this.generation += 1;
        this.stopped = true;
        for (const dispose of this.subscriptions) dispose();
        this.subscriptions = [];
        this.profileSubscription?.unsubscribe();
        this.profileSubscription = null;
        this.supportCheck = null;
        this.native.value = null;
        this.current.value = null;
        this.source.value = "none";
        this.supported.value = null;
        this.error.value = "";
        this.fieldDirty = false;
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
        this.chain = this.chain.then(async () => {
            if (this.stale(generation, userId)) return;
            if (source === "manual" && this.native.value) return;
            // `lastPublished` only means "the field holds this" after a real
            // write. While support is unknown we remember the intent in
            // `fieldDirty`, so the later retry must not short-circuit here.
            if (!force && !this.fieldDirty && sameActivity(document, this.lastPublished) && source !== "none") {
                this.current.value = document;
                this.source.value = source;
                return;
            }
            let wrote = false;
            this.error.value = "";
            try {
                if (this.supported.value) {
                    await this.client.setProfileField(ACTIVITY_FIELD_KEY, document);
                    wrote = true;
                }
                if (this.stale(generation, userId)) return;
                // lastPublished means "the field holds this". It stays null
                // while support is unknown so a later check can publish it.
                this.lastPublished = document;
                this.fieldDirty = !wrote;
                this.current.value = document;
                this.source.value = source;
            } catch (error) {
                this.error.value = reportError(error, "Couldn't update your activity");
                return;
            }
            await this.mirrorActivity(document, generation);
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
