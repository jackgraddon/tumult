import { createApp } from "vue";

import "@tumult/theme/dist/themes/base.css";
import "@tumult/theme/dist/themes/default.css";
import App from "./App.vue";
import { router } from "./router.ts";
import "./styles.css";

createApp(App).use(router).mount("#app");
