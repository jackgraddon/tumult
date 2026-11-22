import type { Plugin } from "@tumult/ui";

import DemoPoll from "../renderers/DemoPoll.vue";
import {
    activityShowcase,
    adminBadge,
    profileShowcase,
    reactLastAction,
    settingsShowcase,
    shrugCommand,
    workspaceShowcase,
} from "./showcase.ts";

/**
 * The reference plugin: registers the demo-poll timeline renderer through the
 * plugin API (manifest + permission + context) instead of poking the registry
 * directly. A game renderer follows this exact shape.
 */
const demoPoll: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.demo-poll",
        name: "Demo Poll",
        version: "1.0.0",
        author: "Tumult",
        description: "Renders cc.jackg.tumult.demo.poll events as a poll.",
        permissions: ["timeline-renderers"],
    },
    install(ctx) {
        ctx.addRenderer("cc.jackg.tumult.demo.poll", { component: DemoPoll, priority: 10 });
    },
};

/**
 * Kept as executable documentation of every extension point, NOT installed by
 * the app. The fake-mode browser suite opts in with the `tumult.referencePlugins`
 * localStorage flag so the seam stays covered; a real client ships these files
 * but renders a plugin-free shell until the user installs something.
 */
const referencePlugins: Plugin[] = [
    demoPoll,
    shrugCommand,
    reactLastAction,
    adminBadge,
    activityShowcase,
    profileShowcase,
    settingsShowcase,
    workspaceShowcase,
];

/** The shell's exposed registry is used only through its public `install`. */
interface ReferencePluginHost {
    install(plugin: Plugin): void;
}

/** Install the reference plugins into one shell's registry, explicitly. */
export function installReferencePlugins(host: ReferencePluginHost): void {
    for (const plugin of referencePlugins) host.install(plugin);
}
