<script setup lang="ts">
import type { MessageView } from "@tumult/core";

defineProps<{ message: MessageView }>();

function optionVotes(content: Readonly<Record<string, unknown>>, index: number): number {
    const votes = content["votes"];
    if (Array.isArray(votes) && typeof votes[index] === "number") return votes[index] as number;
    return 0;
}

function optionsOf(message: MessageView): string[] {
    const options = message.content["options"];
    return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}
</script>

<!--
    Extension-seam proof: this renderer is registered from apps/web, not from
    packages/ui. A game renderer later follows the exact same path.
-->
<template>
    <div class="tumult-poll">
        <p class="tumult-poll-question">📊 {{ String(message.content["question"] ?? "Poll") }}</p>
        <ul class="tumult-poll-options">
            <li v-for="(option, i) in optionsOf(message)" :key="option">
                <button type="button" class="tumult-poll-option" disabled :title="`${optionVotes(message.content, i)} votes`">
                    {{ option }} — {{ optionVotes(message.content, i) }}
                </button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.tumult-poll {
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-pane);
}
.tumult-poll-question {
    margin: 0 0 var(--space-1);
    font-weight: 600;
}
.tumult-poll-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-poll-option {
    width: 100%;
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
}
</style>
