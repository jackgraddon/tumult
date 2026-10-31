<script setup lang="ts">
import { computed, ref } from "vue";

import { usePluginRegistry } from "../plugins/registry.ts";
import { tryUsePluginInstall } from "../plugins/installControls.ts";
import { LANE_SUMMARY } from "../plugins/consent.ts";
import type { PluginManifest } from "../plugins/types.ts";
import type { SettingsTabProps } from "./tabs.ts";
import InstallConsentDialog from "../plugins/InstallConsentDialog.vue";

// Declared so Vue does not fall the tab props through onto the DOM; this tab
// reads the shell's registry instead.
defineProps<SettingsTabProps>();

const plugins = usePluginRegistry();
const install = tryUsePluginInstall();

// A plugin may be installed after this tab first paints (the app installs its
// plugins once the shell is up), so read through the registry's version.
const manifests = computed<PluginManifest[]>(() => {
    void plugins.version.value;
    return plugins.list();
});

// ── Third-party installs ────────────────────────────────────────────────────
// Absent when the app provides no install controller (a bare UI host): the tab
// then shows only the built-in list, exactly as before.
const url = ref("");
const installError = ref("");
const confirmError = ref("");

const installed = computed(() => install?.installed.value ?? []);
const pending = computed(() => install?.pending.value ?? null);
const busy = computed(() => install?.busy.value ?? false);

// A plugin the install controller knows about is third-party even when it is
// not yet in `installed`: the controller registers a freshly installed plugin
// before its record is written, and a record we refused to load never reaches
// the registry at all. Classifying from `installed` alone renders such a plugin
// through the built-ins branch below (`Built in`, no lane badge, no source) for
// as long as that window lasts — which is what made the install test flaky.
const thirdPartyIds = computed<ReadonlySet<string>>(() => install?.thirdPartyIds.value ?? new Set());
const builtIns = computed(() =>
    manifests.value.filter((manifest) => !thirdPartyIds.value.has(manifest.id)),
);

async function onInstall(): Promise<void> {
    if (!install || busy.value) return;
    installError.value = "";
    const outcome = await install.prepare(url.value);
    if (!outcome.ok) installError.value = outcome.error ?? "Could not read that repository.";
}

async function onConfirm(): Promise<void> {
    if (!install) return;
    confirmError.value = "";
    const outcome = await install.confirm();
    if (!outcome.ok) {
        confirmError.value = outcome.error ?? "Install failed.";
        return;
    }
    url.value = "";
}

function onCancel(): void {
    confirmError.value = "";
    install?.cancel();
}

// A trusted-lane plugin ran in-page: unregistering it removes its
// contributions, but anything it patched or scheduled outlives that until the
// page reloads (review finding F5). Say so rather than imply it is gone.
const reloadNeeded = ref(false);

function onDisable(id: string, lane: string): void {
    install?.disable(id);
    if (lane === "trusted") reloadNeeded.value = true;
}

function onRemove(id: string, lane: string): void {
    install?.remove(id);
    if (lane === "trusted") reloadNeeded.value = true;
}

function reload(): void {
    window.location.reload();
}

async function onEnable(id: string): Promise<void> {
    if (!install) return;
    installError.value = "";
    const outcome = await install.enable(id);
    if (!outcome.ok) installError.value = outcome.error ?? "Could not enable that plugin.";
}
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Installed plugins</h3>
        <p v-if="manifests.length === 0 && installed.length === 0" class="tumult-settings-note">
            No plugins are installed.
        </p>

        <p v-if="reloadNeeded" class="tumult-settings-note tumult-plugin-reload" role="status">
            A trusted plugin keeps running until the page reloads.
            <button type="button" class="tumult-plugin-button" @click="reload">Reload now</button>
        </p>

        <!-- Third-party installs: enable/disable/remove, lane badge, source. -->
        <ul v-if="installed.length > 0" class="tumult-plugin-list">
            <li v-for="entry in installed" :key="entry.id" class="tumult-plugin">
                <p class="tumult-plugin-title">
                    <span class="tumult-plugin-name">{{ entry.name }}</span>
                    <span class="tumult-plugin-version">{{ entry.version }}</span>
                    <span
                        class="tumult-plugin-lane"
                        :class="`tumult-plugin-lane-${entry.lane}`"
                        :title="LANE_SUMMARY[entry.lane].blurb"
                    >
                        {{ LANE_SUMMARY[entry.lane].label }}
                    </span>
                </p>
                <code class="tumult-plugin-id">{{ entry.id }}</code>
                <p v-if="entry.description" class="tumult-plugin-desc">{{ entry.description }}</p>
                <p class="tumult-plugin-source">
                    From
                    <a :href="entry.sourceUrl" target="_blank" rel="noopener noreferrer">{{ entry.source }}</a>
                    <template v-if="entry.tag"> ({{ entry.tag }})</template>
                </p>
                <p class="tumult-plugin-perms">
                    Can: {{ entry.permissions.length > 0 ? entry.permissions.join(", ") : "nothing" }}
                </p>
                <div class="tumult-plugin-actions">
                    <button
                        v-if="entry.enabled"
                        type="button"
                        class="tumult-plugin-button"
                        :disabled="busy"
                        @click="onDisable(entry.id, entry.lane)"
                    >
                        Disable
                    </button>
                    <button
                        v-else
                        type="button"
                        class="tumult-plugin-button"
                        :disabled="busy"
                        @click="onEnable(entry.id)"
                    >
                        Enable
                    </button>
                    <button
                        type="button"
                        class="tumult-plugin-button tumult-plugin-remove"
                        :disabled="busy"
                        @click="onRemove(entry.id, entry.lane)"
                    >
                        Remove
                    </button>
                </div>
            </li>
        </ul>

        <!-- Built-ins compiled into the app (no source, no remove). -->
        <ul v-if="builtIns.length > 0" class="tumult-plugin-list">
            <li v-for="manifest in builtIns" :key="manifest.id" class="tumult-plugin">
                <p class="tumult-plugin-title">
                    <span class="tumult-plugin-name">{{ manifest.name }}</span>
                    <span class="tumult-plugin-version">{{ manifest.version }}</span>
                    <span class="tumult-plugin-lane tumult-plugin-lane-builtin">Built in</span>
                </p>
                <code class="tumult-plugin-id">{{ manifest.id }}</code>
                <p v-if="manifest.description" class="tumult-plugin-desc">{{ manifest.description }}</p>
                <p class="tumult-plugin-perms">
                    Permissions: {{ manifest.permissions.join(", ") || "none" }}
                </p>
            </li>
        </ul>

        <!-- Install from a repository URL. -->
        <form v-if="install" class="tumult-plugin-install" novalidate @submit.prevent="onInstall">
            <label class="tumult-plugin-install-label" for="tumult-plugin-url">
                Install from GitHub
            </label>
            <p class="tumult-settings-note">
                Paste a repository URL (or <code>owner/repo</code>). Tumult reads its release
                manifest, shows you what the plugin can do, and verifies the download against a
                hash before anything runs.
            </p>
            <div class="tumult-plugin-install-row">
                <input
                    id="tumult-plugin-url"
                    v-model="url"
                    class="tumult-plugin-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://github.com/owner/repo"
                    :disabled="busy"
                />
                <button type="submit" class="tumult-plugin-button" :disabled="busy || url.trim() === ''">
                    {{ busy ? "Checking…" : "Check" }}
                </button>
            </div>
            <p v-if="installError" class="tumult-plugin-error" role="alert">{{ installError }}</p>
        </form>

        <p class="tumult-settings-note">
            Nothing updates itself. Re-installing is the update path, and a release that asks for
            new permissions always asks you again first.
        </p>
    </section>

    <InstallConsentDialog
        v-if="install"
        :open="pending !== null"
        :pending="pending"
        :busy="busy"
        :error="confirmError"
        @close="onCancel"
        @confirm="onConfirm"
    />
</template>

<style scoped>
.tumult-plugin-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-plugin {
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
}
.tumult-plugin-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
}
.tumult-plugin-name {
    font-weight: var(--weight-semibold);
}
.tumult-plugin-version {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-plugin-lane {
    margin-left: auto;
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.tumult-plugin-lane-trusted {
    border-color: var(--danger, var(--border-default));
    color: var(--text-primary);
}
.tumult-plugin-id {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
.tumult-plugin-desc {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
}
.tumult-plugin-source,
.tumult-plugin-perms {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-plugin-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
.tumult-plugin-button {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
}
.tumult-plugin-button:disabled {
    opacity: var(--state-disabled-opacity);
}
.tumult-plugin-remove {
    color: var(--danger, var(--text-primary));
}
.tumult-plugin-install {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-plugin-install-label {
    display: block;
    font-weight: var(--weight-semibold);
}
.tumult-plugin-install-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
.tumult-plugin-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-plugin-error {
    margin: var(--space-2) 0 0;
    color: var(--danger, var(--text-primary));
    font-size: var(--text-xs);
}
</style>
