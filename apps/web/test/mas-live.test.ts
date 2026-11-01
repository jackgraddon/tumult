import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { firefox } from "playwright";
import type { ViteDevServer } from "vite";
import { createServer } from "vite";

/**
 * Live end-to-end check against the user's real homeserver, driven through the
 * real client in a headed Firefox window. Gated behind `MAS_LIVE=1` (see the
 * `test:live` script) because the first login is interactive: the browser opens,
 * the person at the keyboard completes MAS at the IdP, and the test takes over
 * once the session lands.
 *
 * What it proves beyond the deterministic suites:
 *   - MAS login (discovery → dynamic registration → PKCE → callback) against
 *     mas.jackg.cc, and sync reaching `syncing` on a real account;
 *   - session restore survives a reload (`restoreSession`), not just first boot;
 *   - a real encrypted round trip: the test creates a throwaway space +
 *     encrypted channel, sends a message, and asserts the row decrypts while the
 *     event is ciphertext (`m.room.encrypted`) on the wire — then leaves both.
 *
 * The storage state (localStorage session incl. tokens) is written to the
 * gitignored `test/.mas-session.json` after sync, so later runs can skip the
 * interactive step until the refresh token expires.
 *
 * A freshly logged-in device is UNVERIFIED, so it cannot decrypt history it did
 * not author — the SDK reports those rows as decryption failures. The hard gate
 * is therefore the outbound round trip (which needs no keys from anyone else);
 * historical decryption is reported, not asserted. Verifying the device first
 * (or restoring the recovery key in the UI) would let history decrypt too.
 *
 * NOTE: this creates a real device on the account. `MAS_LIVE_CLEANUP=1` logs it
 * out at the end instead of keeping it.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = dirname(__dirname);

const isLive = process.env.MAS_LIVE === "1";
const statePath = join(__dirname, ".mas-session.json");
const cleanupAfter = process.env.MAS_LIVE_CLEANUP === "1";
const homeserver = process.env.MAS_LIVE_HOMESERVER ?? "matrix.jackg.cc";
const PORT = 5173;

/** Browser-side console noise that is not a Tumult defect. */
const IGNORED_CONSOLE = [
    "Download the React DevTools",
    "[vite]",
    // Background/spec noise: relations whose parent fell outside the window,
    // Firefox refusing a notification prompt outside a user gesture, and the
    // read-marker/pagination best-effort paths logging before falling back.
    "parent event of unhandled relation",
    "Notification permission may only be requested",
    "[tumult] read marker failed",
    "[tumult] timeline pagination failed",
    "One time key",
];

function isIgnoredConsole(text: string): boolean {
    return IGNORED_CONSOLE.some((t) => text.includes(t));
}

/** The saved Playwright storage state, or undefined when absent/unreadable. */
function readStoredState(): object | undefined {
    if (!existsSync(statePath)) return undefined;
    const raw = readFileSync(statePath, "utf8").trim();
    if (!raw) return undefined;
    try {
        return JSON.parse(raw) as object;
    } catch {
        return undefined;
    }
}

describe("mas live", { skip: !isLive }, () => {
    let server: ViteDevServer;
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    const pageErrors: string[] = [];
    const consoleErrorDetail: Promise<string>[] = [];

    const attachConsole = (target: Page) => {
        target.on("console", (msg) => {
            const text = msg.text();
            if (isIgnoredConsole(text)) return;
            if (msg.type() === "error") {
                // Resolve the logged values — the SDK logs bare Error objects, so
                // the message text alone cannot say what failed.
                consoleErrorDetail.push(
                    Promise.all(
                        msg.args().map((a) =>
                            a
                                .evaluate((v: unknown) =>
                                    v instanceof Error ? (v.stack ?? v.message) : typeof v === "string" ? v : JSON.stringify(v),
                                )
                                .catch(() => "<unresolvable>"),
                        ),
                    ).then((parts) => `${text}\n    ${parts.join("\n    ")}`),
                );
            }
        });
        // Uncaught exceptions are reported by the browser, not through
        // console.error, so they need their own listener to carry a stack.
        target.on("pageerror", (err) => {
            pageErrors.push(err.stack ?? err.message ?? String(err));
        });
    };

    before(async () => {
        server = await createServer({
            root: appRoot,
            mode: "development",
            server: { port: PORT, strictPort: true },
        });
        await server.listen();

        browser = await firefox.launch({ headless: false });
        context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            storageState: readStoredState() as never,
        });
        page = await context.newPage();
        attachConsole(page);
    });

    after(async () => {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
        if (server) await server.close();
    });

    it("logs in via MAS, syncs, restores, and round-trips an encrypted message", { timeout: 900_000 }, async () => {
        const origin = `http://localhost:${PORT}`;
        const readSession = () =>
            page.evaluate(() => {
                const raw = localStorage.getItem("tumult.session");
                return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
            });

        const connectionState = () =>
            page.evaluate(() => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                return (c?.connection?.get?.() ?? null) as string | null;
            });

        const waitForSyncing = async (timeoutMs: number): Promise<boolean> => {
            const started = Date.now();
            for (;;) {
                if ((await connectionState().catch(() => null)) === "syncing") return true;
                if (Date.now() - started > timeoutMs) return false;
                await page.waitForTimeout(1000);
            }
        };

        const waitFor = async <T>(fn: () => Promise<T | null>, timeoutMs: number, what: string): Promise<T> => {
            const started = Date.now();
            for (;;) {
                const value = await fn().catch(() => null);
                if (value !== null && value !== undefined && value !== false) return value as T;
                if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
                await page.waitForTimeout(1000);
            }
        };

        await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });

        // A stored session might be dead (rotated/expired token) — probe it
        // cheaply, then either restore it or fall back to an interactive login.
        let interactive = true;
        const stored = await readSession().catch(() => null);
        if (stored) {
            const alive = await page
                .evaluate(
                    async ({ hs, token }: { hs: string; token: string }) => {
                        try {
                            const r = await fetch(`https://${hs}/_matrix/client/v3/account/whoami`, {
                                headers: { Authorization: `Bearer ${token}` },
                            });
                            return r.ok;
                        } catch {
                            return false;
                        }
                    },
                    { hs: homeserver, token: String(stored.accessToken ?? "") },
                )
                .catch(() => false);
            if (alive) {
                console.log("Found a stored session; trying to restore it...");
                interactive = !(await waitForSyncing(90_000));
            }
            if (interactive) {
                console.log(alive ? "Stored session failed to sync; starting over." : "Stored session has expired; starting over.");
                await page.evaluate(() => localStorage.clear());
                await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
            }
        }

        if (interactive) {
            // Drive the app up to the IdP redirect; the human takes it from there.
            await page.locator('input[name="homeserver"], input[placeholder*="matrix"]').fill(homeserver);
            await page.locator('button[type="submit"]').click();
            console.log(`\nClaimed the login form for ${homeserver}.`);
            console.log("Complete the MAS login in the headed Firefox window...\n");
        }

        const session = await waitFor(readSession, 600_000, "the MAS login to complete");
        assert.ok(session, "session should be stored after login");
        assert.ok(
            String(session.homeserverUrl).includes(homeserver),
            "session should point at the live homeserver",
        );
        assert.ok(String(session.userId ?? "").includes(":"), "session should carry a real user id");

        const connection = await waitFor(
            async () => {
                const state = await connectionState();
                return state === "syncing" ? state : null;
            },
            300_000,
            "sync to reach 'syncing'",
        );
        const rooms = await waitFor(
            () =>
                page.evaluate(() => {
                    const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                    const list = (c?.rooms?.get?.() ?? []) as Array<{ id: string; isSpace: boolean }>;
                    return list.length > 0 ? list : null;
                }),
            300_000,
            "rooms to sync",
        );

        // Persist the fresh session (post-sync, so refreshed tokens are captured).
        await writeState();

        console.log(
            `Live account: ${String(session.userId)} @ ${homeserver} — connection ${connection}, ` +
                `${rooms.length} rooms, ${rooms.filter((r) => r.isSpace).length} spaces.`,
        );

        // --- reload: the restoreSession() path, not just a first boot ---
        await page.reload({ waitUntil: "domcontentloaded" });
        assert.ok(await readSession(), "session should persist across a reload");
        await waitFor(
            () =>
                page.evaluate(() => {
                    const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                    return c?.connection?.get?.() === "syncing" ? true : null;
                }),
            300_000,
            "sync after reload",
        );

        // --- clean up anything a previous (buggy) run may have left behind ---
        await leaveTestRooms();

        // --- E2EE hard gate: our own encrypted message round-trips ---
        const parent = await ensureParentSpace();
        const channelId = (await page.evaluate(
            async (spaceId: string) => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                return (await c.createChannel(spaceId, { name: "tumult-live-test", encrypted: true })) as string;
            },
            parent.id,
        )) as string;
        assert.ok(channelId.startsWith("!"), "createChannel should resolve a room id");

        // Let the room land in the feed before the timeline feed exists for it.
        await waitFor(
            () =>
                page.evaluate((cid: string) => {
                    const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                    const list = (c?.rooms?.get?.() ?? []) as Array<{ id: string }>;
                    return list.some((r) => r.id === cid) ? true : null;
                }, channelId),
            60_000,
            "the temp channel to appear in the feed",
        );

        const marker = `tumult-live-test ${Date.now()}`;
        await page.evaluate(
            async ({ cid, body }: { cid: string; body: string }) => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                await c.send(cid, body);
            },
            { cid: channelId, body: marker },
        );

        const sent = await waitFor(
            () =>
                page.evaluate(
                    ({ cid, m }: { cid: string; m: string }) => {
                        const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                        const rows = (c.timeline(cid).get() ?? []) as Array<{ body: string; status: string; decryption: string }>;
                        return rows.find((r) => typeof r.body === "string" && r.body.includes(m)) ?? null;
                    },
                    { cid: channelId, m: marker },
                ),
            60_000,
            "the sent message to appear",
        );

        assert.notStrictEqual(sent.decryption, "failed", "sent message must not report failed decryption");
        assert.notStrictEqual(sent.status, "failed", "sent message must not report a failed send");

        // The wire check reads the raw SDK event through the dev handle — the
        // concrete client's `matrix` field is TS-`private` but a real property at
        // runtime. This is what makes the claim "encrypted on the wire" honest.
        const wire = (await page.evaluate(({ cid, m }: { cid: string; m: string }) => {
            const raw = (window as unknown as { __tumult?: any }).__tumult?.client?.matrix;
            const room = raw?.getRoom(cid);
            if (!room) return { encrypted: false, wireType: null };
            const ev = room
                .getLiveTimeline()
                .getEvents()
                .find((e: { getContent?: () => { body?: string } }) => (e.getContent?.()?.body ?? "").includes(m));
            return {
                encrypted: room.hasEncryptionStateEvent(),
                wireType: ev?.getWireType?.() ?? null,
            };
        }, { cid: channelId, m: marker })) as { encrypted: boolean; wireType: string | null };

        assert.strictEqual(wire.encrypted, true, "the temp channel should be encrypted");
        assert.strictEqual(wire.wireType, "m.room.encrypted", "the sent event must be ciphertext on the wire");

        // --- history: informational only ---
        //
        // This device is freshly logged in and UNVERIFIED, so it has no megolm
        // keys for history it did not author: the SDK reports those rows as
        // decryption failures. That is Matrix working as designed, not a Tumult
        // defect, so the count is reported rather than asserted. What the hard
        // gate above proves is the part a fresh device *can* do — encrypt, send,
        // and decrypt its own outbound session, with real ciphertext on the wire.
        const encryptedRoomIds = (await page.evaluate(() => {
            const raw = (window as unknown as { __tumult?: any }).__tumult?.client?.matrix;
            const all = (raw?.getRooms?.() ?? []) as Array<{ roomId: string; hasEncryptionStateEvent: () => boolean }>;
            return all.filter((r) => r.hasEncryptionStateEvent()).map((r) => r.roomId);
        })) as string[];
        let undecryptable = 0;
        for (const rid of encryptedRoomIds.slice(0, 5)) {
            const rows = (await page.evaluate((cid: string) => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                return (c.timeline(cid).get() ?? []) as Array<{ decryption: string }>;
            }, rid)) as Array<{ decryption: string }>;
            undecryptable += rows.filter((r) => r.decryption === "failed").length;
        }
        console.log(
            `History decryption: ${undecryptable} undecryptable row(s) across ` +
                `${Math.min(encryptedRoomIds.length, 5)} encrypted room(s) — expected for an unverified device.`,
        );

        // --- teardown: leave the throwaway rooms ---
        await page.evaluate(
            async ({ channel, space }: { channel: string; space: string | null }) => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                await c.leave(channel).catch(() => {});
                if (space) await c.leave(space).catch(() => {});
            },
            { channel: channelId, space: parent.created ? parent.id : null },
        );

        if (cleanupAfter) {
            await page.evaluate(() => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                return c.logout();
            });
            try {
                rmSync(statePath, { force: true });
            } catch {
                // Best-effort cleanup: a leftover state file is harmless.
            }
        }

        // Console noise from the SDK's own logger, resolved to the logged value.
        // A transient ConnectionError on the first sliding-sync request is
        // retried and recovered by the SDK (the sync that follows succeeds), so
        // it is reported rather than failed on. Everything else fails the run.
        const logged = await Promise.all(consoleErrorDetail);
        const isTransientNetwork = (entry: string) => /ConnectionError@/.test(entry);
        const transient = logged.filter(isTransientNetwork);
        const fatal = logged.filter((entry) => !isTransientNetwork(entry));
        if (transient.length > 0) {
            console.log(
                `Ignored ${transient.length} transient network log(s) from the SDK (recovered on retry):\n${transient.join("\n\n")}`,
            );
        }
        assert.deepStrictEqual(
            [...fatal, ...pageErrors],
            [],
            `console errors:\n\n${fatal.join("\n\n")}\n\n${pageErrors.join("\n\n")}`,
        );

        /**
         * Best-effort: leave rooms named by this test. Recovers from runs that
         * created a channel without cleaning up.
         */
        async function leaveTestRooms(): Promise<void> {
            await page.evaluate(async () => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                const list = (c?.rooms?.get?.() ?? []) as Array<{ id: string; name: string }>;
                const doomed = list.filter(
                    (r) => r.name === "tumult-live-test" || (r.name ?? "").startsWith("Tumult live test"),
                );
                for (const r of doomed) {
                    await c.leave(r.id).catch(() => {});
                }
            });
        }

        /**
         * A space to nest the throwaway channel in. Prefers an existing space;
         * otherwise creates one so the account needs no pre-existing guild.
         * Reports whether the space was created so only our own is left.
         */
        async function ensureParentSpace(): Promise<{ id: string; created: boolean }> {
            const existing = (await page.evaluate(() => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                const list = (c?.rooms?.get?.() ?? []) as Array<{ id: string; isSpace: boolean }>;
                return list.find((r) => r.isSpace)?.id ?? null;
            })) as string | null;
            if (existing) return { id: existing, created: false };
            const created = (await page.evaluate(async () => {
                const c = (window as unknown as { __tumult?: any }).__tumult?.chat;
                return (await c.createSpace({ name: "Tumult live test (temp)" })) as string;
            })) as string;
            return { id: created, created: true };
        }

        async function writeState(): Promise<void> {
            try {
                const state = await context.storageState();
                mkdirSync(dirname(statePath), { recursive: true });
                writeFileSync(statePath, JSON.stringify(state, null, 2));
            } catch {
                /* storage state is a convenience, not a requirement */
            }
        }
    });
});
