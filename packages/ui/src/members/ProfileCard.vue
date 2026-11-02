<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient, MemberView } from "@tumult/core/contract";

import { useProfileSections } from "./profileSections.ts";
import { presenceLabel } from "./presenceLabel.ts";
import Avatar from "../primitives/Avatar.vue";

const props = defineProps<{
    member: MemberView;
    roomId: string;
    client: ChatClient;
}>();

const sections = useProfileSections();
const resolved = computed(() => sections.resolve(props.member));
const label = computed(() => presenceLabel(props.member));
const statusMessage = computed(() => props.member.statusMessage);
</script>

<template>
    <div class="tumult-profile-card">
        <header class="tumult-profile-card-header">
            <Avatar :label="member.displayName" :src="member.avatarUrl" size="lg" />
            <div class="tumult-profile-card-identity">
                <div class="tumult-profile-card-name" :title="member.displayName">
                    {{ member.displayName }}
                </div>
                <div class="tumult-profile-card-id" :title="member.userId">
                    {{ member.userId }}
                </div>
            </div>
        </header>
        <p class="tumult-profile-card-status">
            {{ label }}<template v-if="statusMessage"> · {{ statusMessage }}</template>
        </p>
        <template v-if="resolved.length">
            <section v-for="section in resolved" :key="section.id" class="tumult-profile-card-section">
                <component :is="section.component" :member="member" :room-id="roomId" :client="client" />
            </section>
        </template>
    </div>
</template>

<style scoped>
.tumult-profile-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: var(--profile-card-width);
    max-width: calc(100vw - var(--space-6));
    padding: var(--space-3);
    border: var(--border-width) solid var(--popover-border);
    border-radius: var(--control-radius);
    background: var(--popover-bg);
    box-shadow: var(--popover-shadow);
    color: var(--text-primary);
}

.tumult-profile-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}

.tumult-profile-card-identity {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}

.tumult-profile-card-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-semibold);
    font-size: var(--text-md);
}

.tumult-profile-card-id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.tumult-profile-card-status {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.tumult-profile-card-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--border-default);
}
</style>
