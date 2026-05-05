<template>
  <UiDialog :open="uiStore.spaceSettingsModalOpen" @update:open="(val: boolean) => { if(!val) uiStore.closeSpaceSettingsModal() }">
    <UiDialogContent class="sm:max-w-[800px] h-[80vh] flex flex-col p-0 bg-background border-border overflow-hidden">
      <div class="flex h-full">
        <!-- Sidebar Tabs -->
        <div class="w-48 border-r bg-muted/30 p-4 flex flex-col gap-1">
          <h2 class="px-2 mb-4 text-lg font-bold">Space Settings</h2>
          <button 
            v-for="tab in tabs" 
            :key="tab.id"
            class="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left"
            :class="activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'"
            @click="activeTab = tab.id"
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
            <UiButton variant="ghost" size="icon" @click="uiStore.closeSpaceSettingsModal">
              <Icon name="solar:close-circle-linear" class="h-6 w-6" />
            </UiButton>
          </header>

          <div class="flex-1 overflow-y-auto p-6">
            <template v-if="!space">
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
                      :mxc-url="space.getMxcAvatarUrl()" 
                      :name="space.name" 
                      class="h-24 w-24 text-3xl"
                      :size="128"
                    />
                    <label class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
                      <Icon name="solar:camera-bold" class="h-8 w-8" />
                      <input type="file" class="hidden" accept="image/*" @change="handleAvatarChange" >
                    </label>
                  </div>
                  <div class="flex-1 space-y-4">
                    <div class="grid gap-2">
                      <UiLabel for="space-name">Space Name</UiLabel>
                      <UiInput id="space-name" v-model="editName" placeholder="Space Name" />
                    </div>
                  </div>
                </div>

                <div class="grid gap-2">
                  <UiLabel for="space-topic">Topic</UiLabel>
                  <UiTextarea id="space-topic" v-model="editTopic" placeholder="What is this space about?" rows="4" />
                </div>

                <div class="flex justify-end pt-4">
                  <UiButton :disabled="isSaving || !hasChanges" @click="saveGeneral">
                    <UiSpinner v-if="isSaving" class="mr-2 h-4 w-4" />
                    Save Changes
                  </UiButton>
                </div>
              </div>
            </template>

            <!-- Rooms Management -->
            <template v-else-if="activeTab === 'rooms'">
              <div class="space-y-6">
                <div class="flex items-center justify-between">
                  <UiLabel>Rooms in this Space</UiLabel>
                  <div class="flex gap-2">
                     <UiButton variant="outline" size="sm" @click="uiStore.openCreateRoomModal">
                        <Icon name="solar:add-circle-bold" class="mr-2 h-4 w-4" />
                        Create New Room
                     </UiButton>
                  </div>
                </div>

                <div class="border rounded-md divide-y overflow-hidden">
                  <div v-for="child in children" :key="child.roomId" class="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group">
                    <MatrixAvatar :mxc-url="child.getMxcAvatarUrl()" :name="child.name" class="h-10 w-10" />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium truncate">{{ child.name }}</div>
                      <div class="text-xs text-muted-foreground truncate">{{ child.roomId }}</div>
                    </div>
                    <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                      <UiButton variant="ghost" size="icon-sm" class="text-destructive" title="Remove from Space" @click="removeChild(child)">
                        <Icon name="solar:trash-bin-trash-bold" class="h-4 w-4" />
                      </UiButton>
                    </div>
                  </div>
                  <div v-if="children.length === 0" class="p-8 text-center text-muted-foreground italic">
                    No rooms in this space yet.
                  </div>
                </div>
              </div>
            </template>

            <!-- Members Settings -->
            <template v-else-if="activeTab === 'members'">
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <UiLabel>Space Members ({{ members.length }})</UiLabel>
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
                      <UiButton v-if="canKick(member)" variant="ghost" size="icon-sm" class="text-amber-500" title="Kick" @click="kickMember(member)">
                        <Icon name="solar:user-minus-bold" class="h-4 w-4" />
                      </UiButton>
                      <UiButton v-if="canBan(member)" variant="ghost" size="icon-sm" class="text-destructive" title="Ban" @click="banMember(member)">
                        <Icon name="solar:forbidden-bold" class="h-4 w-4" />
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
                      No local addresses set for this space.
                    </div>
                    <div v-else class="space-y-2">
                       <div v-for="alias in aliases" :key="alias" class="flex items-center justify-between p-2 bg-muted rounded-md border">
                          <code class="text-xs">{{ alias }}</code>
                       </div>
                    </div>
                    
                    <div class="grid gap-2 pt-2">
                      <UiLabel for="new-alias-space">Add a new local address</UiLabel>
                      <div class="flex items-center gap-2">
                        <span class="text-muted-foreground">#</span>
                        <UiInput id="new-alias-space" v-model="newAlias" placeholder="my-awesome-community" />
                        <span class="text-muted-foreground">:{{ homeserverDomain }}</span>
                        <UiButton size="sm" :disabled="!newAlias.trim()" @click="addAlias">Add</UiButton>
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
import type * as sdk from 'matrix-js-sdk';

const store = useMatrixStore();
const uiStore = useUIStore();
const activeTab = ref('general');
const isSaving = ref(false);

const { matrixService } = useServices();

const editName = ref('');
const editTopic = ref('');
const avatarFile = ref<File | null>(null);

const newAlias = ref('');

const tabs = [
  { id: 'general', label: 'General', icon: 'solar:settings-minimalistic-bold', description: 'Change basic space information.' },
  { id: 'rooms', label: 'Rooms', icon: 'solar:hashtag-bold', description: 'Manage rooms in this space.' },
  { id: 'members', label: 'Members', icon: 'solar:users-group-rounded-bold', description: 'Manage people in this space.' },
  { id: 'visibility', label: 'Visibility', icon: 'solar:eye-bold', description: 'Control who can find and join this space.' },
];

const currentTab = computed(() => tabs.find(t => t.id === activeTab.value));

const spaceId = computed(() => uiStore.activeSettingsSpaceId);
const space = computed(() => spaceId.value ? store.client?.getRoom(spaceId.value) : null);

const members = computed(() => {
  if (!space.value) return [];
  return space.value.getJoinedMembers().sort((a, b) => a.name.localeCompare(b.name));
});

const children = computed(() => {
  if (!space.value || !store.client) return [];
  return space.value.currentState.getStateEvents('m.space.child')
    .map(ev => store.client!.getRoom(ev.getStateKey()!))
    .filter((r): r is sdk.Room => !!r);
});

const aliases = computed(() => {
  if (!space.value) return [];
  const canonical = space.value.getCanonicalAlias();
  const alt = space.value.getAltAliases() || [];
  const all = new Set<string>();
  if (canonical) all.add(canonical);
  alt.forEach(a => all.add(a));
  return Array.from(all);
});

const homeserverDomain = computed(() => store.client?.getDomain() || 'matrix.org');

const joinRuleLabel = computed(() => {
  const rule = space.value?.currentState.getStateEvents('m.room.join_rules', '')?.getContent().join_rule;
  if (rule === 'public') return 'Public';
  if (rule === 'invite') return 'Invite Only';
  return rule || 'Unknown';
});

watch(space, (newSpace) => {
  if (newSpace) {
    editName.value = newSpace.name || '';
    editTopic.value = newSpace.currentState.getStateEvents('m.room.topic', '')?.getContent().topic || '';
  }
}, { immediate: true });

const hasChanges = computed(() => {
  if (!space.value) return false;
  return editName.value !== space.value.name || 
         editTopic.value !== (space.value.currentState.getStateEvents('m.room.topic', '')?.getContent().topic || '') ||
         avatarFile.value !== null;
});

const handleAvatarChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    avatarFile.value = target.files[0];
  }
};

const saveGeneral = async () => {
  if (!spaceId.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await matrixService.updateRoomMetadata(spaceId.value, {
      name: editName.value !== space.value?.name ? editName.value : undefined,
      topic: editTopic.value !== (space.value?.currentState.getStateEvents('m.room.topic', '')?.getContent().topic) ? editTopic.value : undefined,
      avatarFile: avatarFile.value || undefined
    });
    avatarFile.value = null;
  } finally {
    isSaving.value = false;
  }
};

const removeChild = async (child: sdk.Room) => {
  if (!spaceId.value || !store.client) return;
  try {
    // Redact the m.space.child event
    const event = space.value?.currentState.getStateEvents('m.space.child', child.roomId);
    if (event) {
       await store.client.redactEvent(spaceId.value, event.getId()!);
       toast.success('Room removed from space');
    }
  } catch (err: any) {
    toast.error('Failed to remove room', { description: err.message });
  }
};

const openInvite = () => {
  if (!spaceId.value) return;
  store.setInviteRoomId(spaceId.value);
  uiStore.openGlobalSearchModal();
};

const canKick = (member: sdk.RoomMember) => {
  if (!space.value || !store.client) return false;
  const myPowerLevel = space.value.getMember(store.client.getUserId()!)?.powerLevel || 0;
  return myPowerLevel > member.powerLevel && myPowerLevel >= 50;
};

const canBan = (member: sdk.RoomMember) => {
  if (!space.value || !store.client) return false;
  const myPowerLevel = space.value.getMember(store.client.getUserId()!)?.powerLevel || 0;
  return myPowerLevel > member.powerLevel && myPowerLevel >= 50;
};

const kickMember = async (member: sdk.RoomMember) => {
  if (!spaceId.value) return;
  await matrixService.kickUser(spaceId.value, member.userId);
};

const banMember = async (member: sdk.RoomMember) => {
  if (!spaceId.value) return;
  await matrixService.banUser(spaceId.value, member.userId);
};

const setJoinRule = async (rule: string) => {
  if (!spaceId.value) return;
  await matrixService.setRoomJoinRule(spaceId.value, rule);
};

const addAlias = async () => {
  if (!spaceId.value || !newAlias.value.trim()) return;
  try {
    const fullAlias = `#${newAlias.value.trim()}:${homeserverDomain.value}`;
    await store.client?.createAlias(fullAlias, spaceId.value);
    newAlias.value = '';
    toast.success('Address added successfully');
  } catch (err: any) {
    toast.error('Failed to add address', { description: err.message });
  }
};
</script>
