import { createChatClient } from "@tumult/core";
import type { ChatClient } from "@tumult/core";

/**
 * MAS will not accept a loopback address as `client_uri`, so it cannot be
 * derived from `window.location` during local development. It identifies the
 * *application*, not the instance, so it is configuration.
 *
 * Set `VITE_CLIENT_URI` in `apps/web/.env.local` — see `.env.example`.
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
                "(MAS rejects http and rejects localhost). See apps/web/.env.example.",
        );
    }
    return createChatClient({
        clientMetadata: {
            clientName: "Tumult",
            clientUri: appClientUri,
            redirectUri,
            applicationType,
        },
    });
}
