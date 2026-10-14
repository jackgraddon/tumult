import type { ChatClient, MatrixChatClient } from "@tumult/core";
import { createChat } from "@chat-impl";

// `@chat-impl` is chat.real.ts, or chat.fake.ts under `--mode fake`
// (see vite.config.ts) — resolved there as an alias so the unused
// implementation is never linked. The fake stays for the browser tests and for
// offline UI work, where a deterministic client beats a live homeserver.

export const chat: ChatClient = createChat();

if (import.meta.env.DEV) {
    // DevTools handle for diagnosing the live feed, e.g.
    // `__tumult.chat.rooms.get().length` or, per room,
    // `__tumult.client.debugUnread()`. Dev builds only.
    // `createChat()` hands back the ChatClient interface; the concrete class
    // (with its diagnostics) is what actually lives at runtime, so restore
    // that type on the handle only.
    const client = chat as unknown as MatrixChatClient;
    (window as unknown as { __tumult: { chat: ChatClient; client: MatrixChatClient } }).__tumult = { chat, client };
}
