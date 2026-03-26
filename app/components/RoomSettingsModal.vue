<template>
  <UiDialog :open="store.roomSettingsModalOpen" @update:open="(val) => { if(!val) store.closeRoomSettingsModal() }">
    <UiDialogContent class="sm:max-w-[800px] h-[80vh] flex flex-col p-0 bg-background border-border overflow-hidden">
      <div class="flex h-full">
        <!-- Sidebar Tabs -->
        <div class="w-48 border-r bg-muted/30 p-4 flex flex-col gap-1">
          <h2 class="px-2 mb-4 text-lg font-bold">Room Settings</h2>
          <button 
            v-for="tab in tabs" 
            :key="tab.id"
            @click="activeTab = tab.id"
            class="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left"
            :class="activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'"
          >
            <Icon :name="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>

        <!-- Content Area -->
        <div class="flex-1 flex flex-col min-w-0">
          <header class="p-6 border-b flex items-center justify-between">
            <div>
              <h3 class="text-xl font-bold">{{ currentTab?.label }}</h3>
              <p class="text-sm text-muted-foreground">{{ currentTab?.description }}</p>
            </div>
            <UiButton variant="ghost" size="icon" @click="store.closeRoomSettingsModal">
              <Icon name="solar:close-circle-linear" class="h-6 w-6" />
            </UiButton>
          </header>

          <div class="flex-1 overflow-y-auto p-6">
            <template v-if="!room">
              <div class="flex items-center justify-center h-full">
                <UiSpinner class="h-8 w-8" />
              </div>
            </template>

            <!-- General Settings -->
            <template v-else-if="activeTab === 'general'">
              <div class="space-y-6">
                <div class="flex items-center gap-6">
                  <div class="relative group">
                    <MatrixAvatar 
                      :mxc-url="room.getMxcAvatarUrl()" 
                      :name="room.name" 
                      class="h-24 w-24 text-3xl"
                      :size="128"
                    />
                    <label class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
                      <Icon name="solar:camera-bold" class="h-8 w-8" />
                      <input type="file" class="hidden" accept="image/*" @change="handleAvatarChange" />
                    </label>
                  </div>
                  <div class="flex-1 space-y-4">
                    <div class="grid gap-2">
                      <UiLabel for="room-name">Room Name</UiLabel>
                      <UiInput id="room-name" v-model="editName" placeholder="Room Name" />
                    </div>
                  </div>
                </div>

                <div class="grid gap-2">
                  <UiLabel for="room-topic">Topic</UiLabel>
                  <UiTextarea id="room-topic" v-model="editTopic" placeholder="What is this room about?" rows="4" />
                </div>

                <div class="flex justify-end pt-4">
                  <UiButton @click="saveGeneral" :disabled="isSaving || !hasChanges">
                    <UiSpinner v-if="isSaving" class="mr-2 h-4 w-4" />
                    Save Changes
                  </UiButton>
                </div>
              </div>
            </template>

            <!-- Members Settings -->
            <template v-else-if="activeTab === 'members'">
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <UiLabel>Room Members ({{ members.length }})</UiLabel>
                  <UiButton variant="outline" size="sm" @click="openInvite">
                    <Icon name="solar:user-plus-bold" class="mr-2 h-4 w-4" />
                    Invite
                  </UiButton>
                </div>
                <div class="border rounded-md divide-y overflow-hidden">
                  <div v-for="member in members" :key="member.userId" class="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group">
                    <MatrixAvatar :mxc-url="member.getMxcAvatarUrl()" :name="member.name" class="h-10 w-10" />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium truncate">{{ member.name }}</div>
                      <div class="text-xs text-muted-foreground truncate">{{ member.userId }}</div>
                    </div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <UiButton v-if="canKick(member)" variant="ghost" size="icon-sm" class="text-amber-500" @click="kickMember(member)" title="Kick">
                        <Icon name="solar:user-minus-bold" class="h-4 w-4" />
                      </UiButton>
                      <UiButton v-if="canBan(member)" variant="ghost" size="icon-sm" class="text-destructive" @click="banMember(member)" title="Ban">
                        <Icon name="solar:forbidden-bold" class="h-4 w-4" />
                      </UiButton>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Integrations Settings -->
            <template v-else-if="activeTab === 'integrations'">
              <div class="space-y-6">
                <div class="p-4 border rounded-md bg-muted/20">
                  <div class="flex items-center gap-3 mb-4">
                    <Icon name="logos:discord-icon" class="h-6 w-6" />
                    <div>
                      <h4 class="font-bold">Discord Bridge</h4>
                      <p class="text-xs text-muted-foreground">Bridge this room's voice call to a Discord channel.</p>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <div class="grid gap-2">
                      <UiLabel for="discord-guild-id">Discord Guild ID</UiLabel>
                      <UiInput id="discord-guild-id" v-model="discordGuildId" placeholder="e.g. 123456789012345678" />
                    </div>
                    <div class="grid gap-2">
                      <UiLabel for="discord-channel-id">Discord Voice Channel ID</UiLabel>
                      <UiInput id="discord-channel-id" v-model="discordChannelId" placeholder="e.g. 123456789012345678" />
                    </div>

                    <div class="flex justify-end gap-2">
                      <UiButton variant="destructive" size="sm" @click="removeDiscordBridge" :disabled="!hasDiscordBridge">
                        Remove Bridge
                      </UiButton>
                      <UiButton size="sm" @click="saveDiscordBridge" :disabled="!canSaveDiscordBridge">
                        {{ hasDiscordBridge ? 'Update Bridge' : 'Setup Bridge' }}
                      </UiButton>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Visibility Settings -->
            <template v-else-if="activeTab === 'visibility'">
               <div class="space-y-8">
                 <div class="space-y-4">
                    <h4 class="text-sm font-semibold">Join Rules</h4>
                    <div class="grid gap-2">
                       <UiDropdownMenu>
                          <UiDropdownMenuTrigger as-child>
                            <UiButton variant="outline" class="w-full justify-start">
                              {{ joinRuleLabel }}
                              <Icon name="solar:alt-arrow-down-bold" class="ml-auto h-4 w-4 opacity-50" />
                            </UiButton>
                          </UiDropdownMenuTrigger>
                          <UiDropdownMenuContent class="w-[400px]">
                            <UiDropdownMenuItem @select="setJoinRule('invite')">
                              <div>
                                <div class="font-medium">Invite Only</div>
                                <div class="text-xs text-muted-foreground">Only people invited can join.</div>
                              </div>
                            </UiDropdownMenuItem>
                            <UiDropdownMenuItem @select="setJoinRule('public')">
                              <div>
                                <div class="font-medium">Public</div>
                                <div class="text-xs text-muted-foreground">Anyone can join.</div>
                              </div>
                            </UiDropdownMenuItem>
                          </UiDropdownMenuContent>
                       </UiDropdownMenu>
                    </div>
                 </div>

                 <div class="space-y-4 pt-4 border-t">
                    <h4 class="text-sm font-semibold">Local Addresses</h4>
                    <div v-if="aliases.length === 0" class="text-sm text-muted-foreground italic">
                      No local addresses set for this room.
                    </div>
                    <div v-else class="space-y-2">
                       <div v-for="alias in aliases" :key="alias" class="flex items-center justify-between p-2 bg-muted rounded-md border">
                          <code class="text-xs">{{ alias }}</code>
                       </div>
                    </div>
                    
                    <div class="grid gap-2 pt-2">
                      <UiLabel for="new-alias">Add a new local address</UiLabel>
                      <div class="flex items-center gap-2">
                        <span class="text-muted-foreground">#</span>
                        <UiInput id="new-alias" v-model="newAlias" placeholder="my-awesome-room" />
                        <span class="text-muted-foreground">:{{ homeserverDomain }}</span>
                        <UiButton size="sm" @click="addAlias" :disabled="!newAlias.trim()">Add</UiButton>
                      </div>
                    </div>
                 </div>
               </div>
            </template>
          </div>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw } from 'vue';
import { toast } from 'vue-sonner';
import * as sdk from 'matrix-js-sdk';

const store = useMatrixStore();
const activeTab = ref('general');
const isSaving = ref(false);

const editName = ref('');
const editTopic = ref('');
const avatarFile = ref<File | null>(null);

const newAlias = ref('');

const discordGuildId = ref('');
const discordChannelId = ref('');

const tabs = [
  { id: 'general', label: 'General', icon: 'solar:settings-minimalistic-bold', description: 'Change basic room information.' },
  { id: 'members', label: 'Members', icon: 'solar:users-group-rounded-bold', description: 'Manage people in this room.' },
  { id: 'visibility', label: 'Visibility', icon: 'solar:eye-bold', description: 'Control who can find and join this room.' },
  { id: 'integrations', label: 'Integrations', icon: 'solar:plug-connect-bold', description: 'Connect this room to external services.' },
];

const currentTab = computed(() => tabs.find(t => t.id === activeTab.value));

const roomId = computed(() => store.activeSettingsRoomId);
const room = computed(() => roomId.value ? store.client?.getRoom(roomId.value) : null);

const members = computed(() => {
  if (!room.value) return [];
  return room.value.getJoinedMembers().sort((a, b) => a.name.localeCompare(b.name));
});

const aliases = computed(() => {
  if (!room.value) return [];
  const canonical = room.value.getCanonicalAlias();
  const alt = room.value.getAltAliases() || [];
  const all = new Set<string>();
  if (canonical) all.add(canonical);
  alt.forEach(a => all.add(a));
  return Array.from(all);
});

const homeserverDomain = computed(() => store.client?.getDomain() || 'matrix.org');

const joinRuleLabel = computed(() => {
  const rule = room.value?.currentState.getStateEvents('m.room.join_rules', '')?.getContent().join_rule;
  if (rule === 'public') return 'Public';
  if (rule === 'invite') return 'Invite Only';
  if (rule === 'knock') return 'Knock';
  if (rule === 'restricted') return 'Restricted';
  return rule || 'Unknown';
});

watch(room, (newRoom) => {
  if (newRoom) {
    editName.value = newRoom.name || '';
    editTopic.value = newRoom.currentState.getStateEvents('m.room.topic', '')?.getContent().topic || '';

    const discordEvent = newRoom.currentState.getStateEvents('cc.tumult.bridge.discord', '');
    if (discordEvent) {
      const content = discordEvent.getContent();
      discordGuildId.value = content.discord_guild_id || '';
      discordChannelId.value = content.discord_channel_id || '';
    } else {
      discordGuildId.value = '';
      discordChannelId.value = '';
    }
  }
}, { immediate: true });

const hasChanges = computed(() => {
  if (!room.value) return false;
  return editName.value !== room.value.name || 
         editTopic.value !== (room.value.currentState.getStateEvents('m.room.topic', '')?.getContent().topic || '') ||
         avatarFile.value !== null;
});

const handleAvatarChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    avatarFile.value = target.files[0];
  }
};

const saveGeneral = async () => {
  if (!roomId.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await store.updateRoomMetadata(roomId.value, {
      name: editName.value !== room.value?.name ? editName.value : undefined,
      topic: editTopic.value !== (room.value?.currentState.getStateEvents('m.room.topic', '')?.getContent().topic) ? editTopic.value : undefined,
      avatarFile: avatarFile.value || undefined
    });
    avatarFile.value = null;
  } finally {
    isSaving.value = false;
  }
};

const openInvite = () => {
  if (!roomId.value) return;
  store.setInviteRoomId(roomId.value);
  store.openGlobalSearchModal();
};

const canKick = (member: sdk.RoomMember) => {
  if (!room.value || !store.client) return false;
  const myPowerLevel = room.value.getMember(store.client.getUserId()!)?.powerLevel || 0;
  return myPowerLevel > member.powerLevel && myPowerLevel >= 50;
};

const canBan = (member: sdk.RoomMember) => {
  if (!room.value || !store.client) return false;
  const myPowerLevel = room.value.getMember(store.client.getUserId()!)?.powerLevel || 0;
  return myPowerLevel > member.powerLevel && myPowerLevel >= 50;
};

const kickMember = async (member: sdk.RoomMember) => {
  if (!roomId.value) return;
  await store.kickUser(roomId.value, member.userId);
};

const banMember = async (member: sdk.RoomMember) => {
  if (!roomId.value) return;
  await store.banUser(roomId.value, member.userId);
};

const setJoinRule = async (rule: string) => {
  if (!roomId.value) return;
  await store.setRoomJoinRule(roomId.value, rule);
};

const addAlias = async () => {
  if (!roomId.value || !newAlias.value.trim()) return;
  try {
    const fullAlias = `#${newAlias.value.trim()}:${homeserverDomain.value}`;
    await store.client?.createAlias(fullAlias, roomId.value);
    newAlias.value = '';
    toast.success('Address added successfully');
  } catch (err: any) {
    toast.error('Failed to add address', { description: err.message });
  }
};

const hasDiscordBridge = computed(() => {
  return !!room.value?.currentState.getStateEvents('cc.tumult.bridge.discord', '');
});

const canSaveDiscordBridge = computed(() => {
  return discordGuildId.value.trim().length > 0 && discordChannelId.value.trim().length > 0;
});

const saveDiscordBridge = async () => {
  if (!roomId.value || !canSaveDiscordBridge.value) return;
  try {
    await store.client?.sendStateEvent(roomId.value, 'cc.tumult.bridge.discord', {
      discord_guild_id: discordGuildId.value.trim(),
      discord_channel_id: discordChannelId.value.trim(),
    }, '');
    toast.success('Discord bridge configured');
  } catch (err: any) {
    toast.error('Failed to save bridge', { description: err.message });
  }
};

const removeDiscordBridge = async () => {
  if (!roomId.value) return;
  try {
    await store.client?.sendStateEvent(roomId.value, 'cc.tumult.bridge.discord', {}, '');
    discordGuildId.value = '';
    discordChannelId.value = '';
    toast.success('Discord bridge removed');
  } catch (err: any) {
    toast.error('Failed to remove bridge', { description: err.message });
  }
};
</script>
