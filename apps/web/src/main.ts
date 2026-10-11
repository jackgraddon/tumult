import { createApp } from "vue";
import { hasStoredSession } from "@tumult/core/session";

import "@tumult/theme/dist/themes/base.css";
import "@tumult/theme/dist/themes/default.css";
import App from "./App.vue";
import { router } from "./router.ts";
import "./styles.css";

// The router guard and the shell are deliberately SDK-free, so the client
// (and its 1 MB matrix-js-sdk chunk) is a dynamic import. When a session is
// persisted, kick that import off now so the SDK downloads alongside the route
// chunk instead of after it — the shell then paints while the SDK arrives.
// Signed out, we leave it alone: /login has no use for the SDK yet. A failure
// here is ignored: AppView awaits the same module and reports it.
if (hasStoredSession()) void import("./chat.ts").catch(() => {});

createApp(App).use(router).mount("#app");
