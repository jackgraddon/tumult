<script setup lang="ts">
import { computed } from "vue";

import RoomDialog from "../rooms/RoomDialog.vue";
import { LANE_SUMMARY, PERMISSION_SUMMARY } from "../plugins/consent.ts";
import type { PendingInstall } from "../plugins/installControls.ts";

const props = defineProps<{
    open: boolean;
    /** The verified release awaiting consent; null when closed. */
    pending: PendingInstall | null;
    busy?: boolean | undefined;
    error?: string | undefined;
}>();

const emit = defineEmits<{
    close: [];
    confirm: [];
}>();

const lane = computed(() => (props.pending ? LANE_SUMMARY[props.pending.lane] : null));

const title = computed(() => {
    const name = props.pending?.manifest.name;
    if (!name) return "Install plugin";
    return props.pending?.previousVersion
        ? `Update “${name}”`
        : `Install “${name}”?`;
});

const description = computed(() => {
    const manifest = props.pending?.manifest;
    if (!manifest) return "";
    const author = manifest.author ? ` by ${manifest.author}` : "";
    const from = props.pending?.tag ? ` (release ${props.pending.tag})` : "";
    return `Version ${manifest.version}${author}${from}.`;
});

const submitLabel = computed(() => (props.pending?.previousVersion ? "Update" : "Install"));

/** Permissions to list, noting any that are newly requested since last time. */
const permissions = computed(() => {
    const manifest = props.pending?.manifest;
    if (!manifest) return [];
    const added = new Set(props.pending?.added ?? []);
    return manifest.permissions.map((permission) => ({
        permission,
        copy: PERMISSION_SUMMARY[permission] ?? permission,
        isNew: added.has(permission),
    }));
});
</script>

<template>
    <RoomDialog
        :open="props.open"
        :title="title"
        :description="description"
        :submit-label="submitLabel"
        :busy="props.busy"
        :error="props.error"
        @close="emit('close')"
        @submit="emit('confirm')"
    >
        <div v-if="props.pending" class="tumult-consent">
            <p v-if="props.pending.changed" class="tumult-consent-changed" role="alert">
                This release asks for something different from the version you already have. Review
                the permissions before updating.
            </p>

            <p class="tumult-consent-source">
                <span class="tumult-consent-label">From</span>
                <a :href="props.pending.sourceUrl" target="_blank" rel="noopener noreferrer">
                    {{ props.pending.source }}
                </a>
            </p>

            <div v-if="lane" class="tumult-consent-lane" :class="`tumult-consent-lane-${props.pending.lane}`">
                <p class="tumult-consent-lane-label">{{ lane.label }}</p>
                <p class="tumult-consent-lane-blurb">{{ lane.blurb }}</p>
                <p v-if="lane.warning" class="tumult-consent-lane-warning" role="alert">
                    {{ lane.warning }}
                </p>
            </div>

            <div class="tumult-consent-perms">
                <p class="tumult-consent-label">This plugin can</p>
                <ul v-if="permissions.length > 0" class="tumult-consent-perm-list">
                    <li
                        v-for="item in permissions"
                        :key="item.permission"
                        class="tumult-consent-perm"
                        :class="{ 'tumult-consent-perm-new': item.isNew }"
                    >
                        {{ item.copy }}
                        <span v-if="item.isNew" class="tumult-consent-perm-tag">new</span>
                    </li>
                </ul>
                <p v-else class="tumult-consent-perm-none">
                    It declares no permissions, so it cannot change anything yet.
                </p>
            </div>

            <p class="tumult-consent-hash">
                <span class="tumult-consent-label">Verified hash</span>
                <code class="tumult-consent-code">{{ props.pending.integrity }}</code>
            </p>

            <p class="tumult-consent-note">
                The hash pins exactly what was downloaded. It does not say the plugin is safe — it
                says the file is the one the author published.
            </p>
        </div>
    </RoomDialog>
</template>

<style scoped>
.tumult-consent {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.tumult-consent-label {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.tumult-consent-changed {
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--banner-reconnect-bg);
    border-radius: var(--control-radius);
    background: var(--banner-reconnect-bg);
    color: var(--text-primary);
    font-size: var(--text-sm);
}
.tumult-consent-source,
.tumult-consent-hash {
    margin: 0;
}
.tumult-consent-lane {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
}
.tumult-consent-lane-trusted {
    border-color: var(--banner-error-bg);
}
.tumult-consent-lane-label {
    margin: 0;
    font-weight: var(--weight-semibold);
}
.tumult-consent-lane-blurb,
.tumult-consent-lane-warning {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-consent-lane-warning {
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-consent-perm-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
}
.tumult-consent-perm {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-consent-perm-new {
    color: var(--text-primary);
}
.tumult-consent-perm-tag {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: var(--text-xs);
}
.tumult-consent-perm-none,
.tumult-consent-note {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-consent-code {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
</style>
