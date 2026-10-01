<script setup lang="ts">
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import TimelineViewport from "./TimelineViewport.vue";
import MessageComposer from "./MessageComposer.vue";

const props = defineProps<{
    client: ChatClient;
    roomId: string;
}>();

const messages = useSubscribable(props.client.timeline(props.roomId));

async function onSend(body: string): Promise<void> {
    await props.client.send(props.roomId, body);
}
</script>

<template>
    <TimelineViewport :messages="messages" />
    <MessageComposer @send="onSend" />
</template>
