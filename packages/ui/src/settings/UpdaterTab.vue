<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

import { DesktopUpdaterKey, type UpdateSnapshot } from "../updater/bridge.ts";
import type { SettingsTabProps } from "./tabs.ts";

// App updates are desktop-only. The shell registers this tab only when the
// preload exposed its bridge; on web (or in a host with no updater) the
// component still degrades to an honest "unsupported" page.
defineProps<SettingsTabProps>();
const updater = inject(DesktopUpdaterKey, null);

const snapshot = shallowRef<UpdateSnapshot>(
    updater?.snapshot() ?? {
        phase: "unsupported",
        message: "Updates are not available in this build.",
    },
);
const localError = ref<string | null>(null);

let unsubscribe: (() => void) | null = null;
onMounted(() => {
    unsubscribe = updater?.onUpdate((next) => {
        snapshot.value = next;
        if (next.phase !== "error") localError.value = null;
    }) ?? null;
});
onBeforeUnmount(() => unsubscribe?.());

const busy = computed(() =>
    ["checking", "downloading", "installing"].includes(snapshot.value.phase),
);
const error = computed(() =>
    localError.value ?? (snapshot.value.phase === "error" ? snapshot.value.message ?? null : null),
);
const percent = computed(() => Math.round((snapshot.value.progress ?? 0) * 100));
const version = computed(() => snapshot.value.version);

const status = computed(() => {
    const current = snapshot.value;
    switch (current.phase) {
        case "unsupported": return current.message ?? "Updates are not available in this build.";
        case "idle": return "No update has been checked for yet.";
        case "checking": return "Checking for a newer version…";
        case "not-available": return "You're up to date.";
        case "available": return version.value ? `Version ${version.value} is available.` : "An update is available.";
        case "downloading": return version.value ? `Downloading version ${version.value}… ${percent.value}%` : `Downloading… ${percent.value}%`;
        case "downloaded": return version.value ? `Version ${version.value} is ready to install.` : "The update is ready to install.";
        case "installing": return "Installing… Tumult will restart when the update is applied.";
        case "error": return "The update could not be completed.";
        default: return "Updates are not available in this build.";
    }
});

async function run(command: "check" | "download"): Promise<void> {
    if (!updater) return;
    localError.value = null;
    try {
        snapshot.value = command === "check" ? await updater.check() : await updater.download();
    } catch (cause) {
        localError.value = reportError(
            cause,
            command === "check" ? "Couldn't check for updates" : "Couldn't download the update",
        );
    }
}

function install(): void {
    if (!updater) return;
    localError.value = null;
    try {
        updater.install();
    } catch (cause) {
        localError.value = reportError(cause, "Couldn't install the update");
    }
}
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Updates</h3>
        <p class="tumult-settings-note">
            Checks are manual. Nothing is downloaded until you ask for it, and
            installing closes Tumult while the new build is put in place.
        </p>

        <p class="tumult-updater-status" data-testid="updater-status" role="status">{{ status }}</p>
        <div
            v-if="snapshot.phase === 'downloading'"
            class="tumult-updater-progress"
            role="progressbar"
            :aria-valuenow="percent"
            aria-valuemin="0"
            aria-valuemax="100"
        >
            <span class="tumult-updater-progress-fill" :style="{ width: `${percent}%` }"></span>
        </div>
        <p v-if="error" class="tumult-updater-error" data-testid="updater-error" role="alert">{{ error }}</p>

        <div class="tumult-updater-actions">
            <button
                v-if="['unsupported', 'idle', 'not-available'].includes(snapshot.phase)"
                type="button"
                class="tumult-dialog-button"
                :disabled="!updater"
                data-testid="updater-check"
                @click="run('check')"
            >
                Check for updates
            </button>
            <button
                v-if="snapshot.phase === 'available'"
                type="button"
                class="tumult-dialog-button tumult-dialog-primary"
                :disabled="busy"
                data-testid="updater-download"
                @click="run('download')"
            >
                Download update
            </button>
            <button
                v-if="snapshot.phase === 'available'"
                type="button"
                class="tumult-dialog-button"
                :disabled="busy"
                data-testid="updater-recheck"
                @click="run('check')"
            >
                Check again
            </button>
            <button
                v-if="snapshot.phase === 'downloaded'"
                type="button"
                class="tumult-dialog-button tumult-dialog-primary"
                data-testid="updater-install"
                @click="install"
            >
                Restart to install
            </button>
            <button
                v-if="snapshot.phase === 'error'"
                type="button"
                class="tumult-dialog-button"
                :disabled="!updater"
                data-testid="updater-retry"
                @click="run(version ? 'download' : 'check')"
            >
                {{ version ? 'Retry download' : 'Try again' }}
            </button>
        </div>

        <p class="tumult-settings-note">
            AppImage and Windows installs update themselves here. deb and rpm
            packages are upgraded with your package manager, so this page does
            not try to replace files they own.
        </p>
    </section>
</template>

<style scoped>
.tumult-updater-status {
    margin: var(--space-3) 0 var(--space-2);
    color: var(--text-primary);
}
.tumult-updater-progress {
    display: block;
    width: 100%;
    height: var(--activity-progress-height);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--surface-inset);
}
.tumult-updater-progress-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--accent);
}
.tumult-updater-error {
    margin: var(--space-2) 0 0;
    color: var(--danger);
    font-size: var(--text-sm);
}
.tumult-updater-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0;
}
</style>
