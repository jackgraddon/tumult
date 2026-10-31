import type { ProfileView, Subscribable } from "../contract.ts";
import type { ClientContext } from "../client-context.ts";
import { Observable } from "../observable.ts";
import { fallbackName, readProfile, writeProfile } from "./profile.ts";
import { assertProfileFieldKey, ProfileFieldStore } from "./profile-fields.ts";

/**
 * Our own profile (display name + avatar) and MSC4133 extended profile
 * fields. The feed is created once and lives for the client's whole life;
 * the support check and field cache are reset on stop ({@link resetForStop}),
 * since a different session may land on a different server.
 */
export class ProfileController {
    public readonly feed = new Observable<ProfileView | null>(null);

    private readonly ctx: ClientContext;
    /**
     * MSC4133 support, asked once per started client (`null` = not asked).
     * Reset on stop: a different session may land on a different server.
     */
    private support: Promise<boolean> | null = null;
    private readonly fields: ProfileFieldStore;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(ctx: ClientContext) {
        this.ctx = ctx;
        this.fields = new ProfileFieldStore((userId, key) => this.readField(userId, key), {
            ttlMs: 5 * 60_000,
        });
    }

    /**
     * Publish our profile. Never throws: an offline start still gets a
     * readable fallback (the mxid localpart), which is just restating the id
     * we already show — not a name the server ever claimed.
     */
    public async refresh(): Promise<void> {
        const client = this.ctx.matrix();
        const userId = client?.getUserId();
        if (!client || !userId) return;
        try {
            this.feed.set(await readProfile(client));
        } catch {
            this.feed.set({ userId, displayName: fallbackName(userId), avatarUrl: null });
        }
    }

    public async set(params: { displayName?: string; avatar?: Blob | null }): Promise<void> {
        const client = this.ctx.matrix();
        if (!client) throw new Error("Cannot set profile before start()");
        try {
            await writeProfile(client, params);
        } catch (error) {
            // A half-applied change (name landed, upload failed) must show
            // what the server actually stored — refresh first, then rethrow.
            await this.refresh();
            throw error;
        }
        await this.refresh();
    }

    public fieldsSupported(): Promise<boolean> {
        const client = this.ctx.matrix();
        if (!client) return Promise.resolve(false);
        this.support ??= client.doesServerSupportExtendedProfiles().catch((error: unknown) => {
            console.error("[tumult] extended profile support check failed", error);
            this.support = null; // transient — ask again next time
            return false;
        });
        return this.support;
    }

    public field(userId: string, key: string): Subscribable<unknown> {
        return this.fields.feed(userId, key);
    }

    public async setField(key: string, value: unknown): Promise<void> {
        assertProfileFieldKey(key);
        const client = this.ctx.matrix();
        const userId = client?.getUserId();
        if (!client || !userId) throw new Error("Cannot set a profile field before start()");
        if (!(await this.fieldsSupported())) {
            throw new Error("This homeserver does not support extended profile fields (MSC4133)");
        }
        if (value === null || value === undefined) {
            await client.deleteExtendedProfileProperty(key);
            this.fields.publish(userId, key, null);
        } else {
            await client.setExtendedProfileProperty(key, value);
            this.fields.publish(userId, key, value);
        }
    }

    /** Stop-only reset: forget the support answer and empty the field cache. */
    public resetForStop(): void {
        this.support = null;
        this.fields.clear();
    }

    /**
     * One field read for the store: `undefined` when we cannot ask (no client
     * yet — the store retries on the next watch), `null` when unsupported or
     * unset (404), the raw value otherwise. Other failures throw, which the
     * store logs and leaves stale.
     */
    private async readField(userId: string, key: string): Promise<unknown> {
        const client = this.ctx.matrix();
        if (!client) return undefined;
        if (!(await this.fieldsSupported())) return null;
        try {
            return (await client.getExtendedProfileProperty(userId, key)) ?? null;
        } catch (error) {
            if ((error as { httpStatus?: number }).httpStatus === 404) return null;
            throw error;
        }
    }
}
