import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { hasStoredSession } from "@tumult/core/session";

const routes: RouteRecordRaw[] = [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/auth/callback", name: "callback", component: () => import("./views/CallbackView.vue") },
    { path: "/dms/:roomId?", name: "dms", component: () => import("./views/AppView.vue") },
    { path: "/g/:guildId/:roomId?", name: "guild", component: () => import("./views/AppView.vue") },
    { path: "/p/:paneId", name: "pane", component: () => import("./views/AppView.vue") },
    { path: "/", redirect: "/dms" },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

/**
 * Deciding where to go only needs to know whether a *persisted* session
 * exists, and that is a localStorage read — no SDK. Restoring the client
 * itself (which does need matrix-js-sdk) now happens in AppView, after the
 * shell has painted, so the SDK chunk streams in behind the first paint
 * instead of blocking navigation.
 *
 * State is read fresh on every navigation, never memoized: a logout clears the
 * session, and a memoized answer would keep matching the signed-in branch and
 * bounce straight back from /login.
 */
router.beforeEach((to) => {
    // The callback route is what *creates* the session, so it must stay open.
    if (to.name === "callback") return true;

    const hasSession = hasStoredSession();

    if (!hasSession && to.name !== "login") return { name: "login" };
    if (hasSession && to.name === "login") return { name: "dms" };
    return true;
});
