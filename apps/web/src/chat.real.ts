import { createChatClient } from "@tumult/core";
import type { ChatClient } from "@tumult/core";

/**
 * MAS will not accept a loopback address as `client_uri`, so it cannot be
 * derived from `window.location` during local development. It identifies the
 * *application*, not the instance, so it is configuration.
 *
 * Set `VITE_CLIENT_URI` in `.env.local` at the repo root — see `.env.example`
 * (Vite reads env from there via `envDir`; see `apps/web/vite.config.ts`).
 */
const clientUri = import.meta.env.VITE_CLIENT_URI;

/**
 * Narrowed once at the call site. The build is supposed to guarantee this (see
 * `vite.config.ts`): a production build without `VITE_CLIENT_URI` fails, so a
 * deployed bundle cannot reach the throw below. It stays as a defensive check
 * rather than being deleted, because silently proceeding without a client URI
 * would mis-register the app with the IdP.
 *
 * It is deliberately inside `createChat()` and NOT at module scope: a module
 * scope throw runs during import, before the app mounts, so the page renders
 * nothing at all (the failure that produced a blank site is documented in
 * `vite.config.ts`). Here it surfaces as a mount error the shell can report.
 */
const appClientUri: string = clientUri ?? "";

/**
 * Optional: the call app to embed. Unset leaves calls off rather than guessing
 * a public instance — the call app needs a LiveKit backend advertised by the
 * user's homeserver, which only the operator knows exists.
 */
const elementCallUrl = import.meta.env.VITE_ELEMENT_CALL_URL;

/**
 * Optional: native audio voice (MatrixRTC + LiveKit, no iframe). Opt-in rather
 * than detected because it needs a LiveKit focus this deployment cannot know
 * about (a user's homeserver may advertise one, and a call already running in a
 * room is joined with ITS focus); with the flag off no voice control is drawn.
 */
const voiceEnabled = import.meta.env.VITE_VOICE === "1";

const redirectUri = `${window.location.origin}/auth/callback`;

/**
 * A browser app served over http can only be on loopback, and MAS only permits
 * a loopback redirect for a `native` client. So the application type follows
 * from how this instance is actually served: https deployment registers as
 * `web`, local dev registers as `native`.
 */
const applicationType = window.location.protocol === "https:" ? "web" : "native";

/**
 * The single ChatClient for this window.
 *
 * One instance per renderer is a hard requirement, not a convenience: the
 * crypto stack is not thread-safe, and two MatrixClients against the same
 * IndexedDB will corrupt the store and break decryption.
 */
export function createChat(): ChatClient {
    if (!appClientUri) {
        throw new Error(
            "VITE_CLIENT_URI is not set. It must be a public https URL you control " +
                "(MAS rejects http and rejects localhost). See .env.example at the repo root.",
        );
    }
    return createChatClient({
        // Classic /sync by default. A warm refresh with sliding sync has to
        // re-pull the whole window from scratch (the SDK keeps its window
        // cursor loop-local and does not persist it), so the first sync is a
        // full resync — measured ~1.64 MB on a 92-room account, the thing the
        // cache-first seed had to hide. Classic instead resumes incrementally
        // from the persisted IndexedDBStore token, so the first refresh is a
        // delta (measured 193 B for a quiet account) and the start is warm with
        // no collapse. The cost is a heavier steady-state body (all room state
        // per long-poll vs SSS's window), negligible for a personal account. The
        // SSS-only trackers (UnreadTracker, PresencePoller) are gated off in
        // classic mode in core, where the server supplies exact unread counts and
        // sync-carried presence instead.
        syncMode: "classic",
        ...(elementCallUrl ? { elementCallUrl } : {}),
        // LiveKit encrypts media frames in a worker; only this bundler can build
        // it. Dynamic + inline: it is fetched on the first join (never in the
        // main chunk) and is a blob: worker, which the CSP's `worker-src blob:`
        // already allows.
        ...(voiceEnabled
            ? {
                  createE2EEWorker: async (): Promise<Worker> =>
                      new (await import("livekit-client/e2ee-worker?worker&inline")).default(),
              }
            : {}),
        clientMetadata: {
            clientName: "Tumult",
            clientUri: appClientUri,
            redirectUri,
            applicationType,
        },
    });
}
