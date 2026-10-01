import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { chat } from "./chat.ts";

const routes: RouteRecordRaw[] = [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/auth/callback", name: "callback", component: () => import("./views/CallbackView.vue") },
    { path: "/", name: "home", component: () => import("./views/HomeView.vue") },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

/**
 * Restoring the persisted session has to happen before the first guarded
 * navigation resolves, or a reload bounces a signed-in user to /login.
 */
let restored: Promise<boolean> | null = null;

router.beforeEach(async (to) => {
    // The callback route is what *creates* the session, so it must stay open.
    if (to.name === "callback") return true;

    restored ??= chat.restoreSession();
    const hasSession = (await restored) || chat.session.get() !== null;

    if (!hasSession && to.name !== "login") return { name: "login" };
    if (hasSession && to.name === "login") return { name: "home" };
    return true;
});
