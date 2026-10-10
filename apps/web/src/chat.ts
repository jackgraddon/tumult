import type { ChatClient, MatrixChatClient } from "@tumult/core";
import { createChat } from "./chat.real.ts";

// Slice 2 ran on "./chat.fake.ts". Slice 3 points at the real client; the fake
// stays for tests and offline UI work — swap this one import to go back.

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
