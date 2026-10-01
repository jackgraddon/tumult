import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { chat } from "./chat.ts";

const routes: RouteRecordRaw[] = [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/auth/callback", name: "callback", component: () => import("./views/CallbackView.vue") },
    { path: "/dms/:roomId?", name: "dms", component: () => import("./views/AppView.vue") },
    { path: "/g/:guildId/:roomId?", name: "guild", component: () => import("./views/AppView.vue") },
    { path: "/", redirect: "/dms" },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

/**
 * Rehydrating the persisted session has to finish before the first guarded
 * navigation resolves, or a reload bounces a signed-in user to /login.
 *
 * This memoizes the *attempt*, never the answer. Holding on to the result
 * would make the guard permanently believe whatever was true at startup, so a
 * logout could not take effect: navigation to /login would keep matching the
 * "already signed in" branch and bounce straight back.
 */
let restoreAttempted: Promise<unknown> | null = null;

router.beforeEach(async (to) => {
    // The callback route is what *creates* the session, so it must stay open.
    if (to.name === "callback") return true;

    restoreAttempted ??= chat.restoreSession();
    await restoreAttempted;

    // Live state, read fresh on every navigation.
    const hasSession = chat.session.get() !== null;

    if (!hasSession && to.name !== "login") return { name: "login" };
    if (hasSession && to.name === "login") return { name: "dms" };
    return true;
});
