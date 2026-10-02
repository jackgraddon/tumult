import type { ChatClient } from "@tumult/core";
import { createChat } from "./chat.real.ts";

// Slice 2 ran on "./chat.fake.ts". Slice 3 points at the real client; the fake
// stays for tests and offline UI work — swap this one import to go back.

export const chat: ChatClient = createChat();

if (import.meta.env.DEV) {
    // DevTools handle for diagnosing the live feed, e.g.
    // `__tumult.chat.rooms.get().length`. Dev builds only.
    (window as unknown as { __tumult: { chat: ChatClient } }).__tumult = { chat };
}
