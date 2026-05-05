<template>
  <div class="flex flex-col h-full relative">
    <KeychainWarningDialog
      v-model="showKeychainWarning"
      @proceed="handleProceed"
      @cancel="handleCancel"
    />

    <!-- Room Header -->
    <header v-if="room" class="flex-none p-4 border-b border-border">
      <div class="flex items-center justify-between gap-2">
        <UiButton
          v-if="!uiStore.sidebarOpen && !uiStore.memberListVisible"
          variant="ghost"
          size="icon-sm"
          class="md:hidden shrink-0"
          @click="uiStore.toggleSidebar(true)"
        >
          <Icon name="solar:hamburger-menu-linear" class="h-6 w-6" />
        </UiButton>

        <div :class="{'hidden md:block': uiStore.memberListVisible}" class="flex-1 min-w-0">
          <div 
            v-long-press="() => { if (uiStore.hapticFeedbackEnabled) trigger('medium'); uiStore.openRoomContextMenu(roomId as string); }"
            class="cursor-pointer group/header"
            @contextmenu.capture="uiStore.openRoomContextMenu(roomId as string)"
          >
            <RoomHeader 
              v-if="!isDm"
              :name="room?.name || 'Unknown Room'"
              :topic="roomTopic"
              class="w-full"
            />
            <UserProfile 
              v-else
              :avatar-url="roomAvatarUrl"
              :name="room?.name"
              :user-id="otherUserId"
              :topic="roomTopic"
              name-classes="text-lg font-semibold"
              class="w-full"
            />
          </div>
        </div>
        <div class="flex items-center gap-2 pr-2">
          <UiButton 
            v-if="voiceStore.activeRoomId !== roomId && !otherUserId?.startsWith('@discord_')"
            variant="ghost" 
            size="icon-sm" 
            :disabled="voiceStore.isConnecting"
            title="Start Call"
            class="rounded-full"
            @click="handleJoinCall(toRaw(room) as any)"
          >
            <Icon v-if="voiceStore.isConnecting && voiceStore.activeRoomId === roomId" name="svg-spinners:ring-resize" class="h-5 w-5 text-muted-foreground" />
            <Icon v-else name="solar:phone-calling-linear" class="h-5 w-5 text-green-500" />
          </UiButton>
          <UiButton
            v-if="voiceStore.activeRoomId === roomId"
            variant="ghost" 
            size="icon-sm" 
            :title="isCallUiHidden ? 'Show Call UI' : 'Hide Call UI'"
            class="rounded-full"
            @click="isCallUiHidden = !isCallUiHidden"
          >
            <Icon :name="isCallUiHidden ? 'solar:maximize-square-minimalistic-linear' : 'solar:minimize-square-minimalistic-linear'" class="h-5 w-5 text-foreground" />
          </UiButton>
          <UiButton
            v-if="voiceStore.activeRoomId === roomId"
            variant="ghost" 
            size="icon-sm" 
            title="Disconnect Call"
            class="rounded-full"
            @click="voiceStore.leaveVoiceRoom()"
          >
            <Icon name="solar:end-call-bold" class="h-5 w-5 text-red-500" />
          </UiButton>

            <UiButton
              variant="ghost"
              size="icon-sm"
              :class="{ 'bg-accent text-accent-foreground': uiStore.memberListVisible }"
              title="Toggle Member List"
              class="rounded-full"
              @click="() => { uiStore.toggleMemberList(); uiStore.toggleSidebar(false); }"
            >
              <Icon name="solar:users-group-rounded-linear" class="h-5 w-5" />
            </UiButton>
          </div>
      </div>

      <!-- Incoming Call Banner -->
      <IncomingCallBanner 
        v-if="room && isJoined" 
        :room-id="roomId as string" 
        :room-name="room?.name || 'Unknown Room'" 
        class="mt-4 mx-4"
      />
    </header>

    <!-- Main Chat Content Area -->
    <div class="flex-1 flex flex-col relative min-h-0">
      <!-- Voice Call Overlay (Below Header) -->
      <MatrixVoiceCall 
        v-if="voiceStore.activeRoomId === roomId && voiceStore.lkRoom && voiceStore.isConnected" 
        :room="toRaw(voiceStore.lkRoom) as any" 
        :room-id="roomId as string"
        :room-name="room?.name || 'Voice Room'"
        :is-minimized="isCallUiHidden"
        :class="isCallUiHidden ? 'w-full flex-none h-16 md:h-20 z-40 w-full rounded-xl shadow-sm transition-all' : 'absolute inset-0 z-[60] transition-all'"
        @disconnect="voiceStore.leaveVoiceRoom()"
      />

      <!-- Invite Prompt -->
      <div v-if="room && isInvited" class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/20">
      <div class="max-w-md w-full space-y-8 animate-in fade-in zoom-in duration-300">
        <div class="flex flex-col items-center gap-4">
          <MatrixAvatar 
            :mxc-url="roomAvatarUrl" 
            :name="room?.name" 
            class="h-24 w-24 border-4 border-background shadow-xl"
            :size="128"
          />
          <div class="space-y-2">
            <h2 class="text-2xl font-bold tracking-tight">{{ room?.name }}</h2>
            <p v-if="inviterName" class="text-muted-foreground">
              <span class="font-semibold text-foreground">{{ inviterName }}</span> invited you to join this {{ isDm ? 'direct chat' : 'room' }}.
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <UiButton size="lg" class="w-full font-bold h-12 text-base" @click="matrixService.acceptInvite(roomId as string)">
            Accept Invite
          </UiButton>
          <UiButton variant="outline" size="lg" class="w-full font-semibold h-12 text-base" @click="matrixService.declineInvite(roomId as string)">
            Decline
          </UiButton>
        </div>

        <div v-if="roomTopic" class="p-4 rounded-xl bg-background/50 border border-border text-sm text-muted-foreground italic leading-relaxed">
          &ldquo;{{ roomTopic }}&rdquo;
        </div>
      </div>
    </div>

    <!-- Loading / Hydration state -->
    <div v-if="!room || (store.isRestoringSession && !store.isFullySynced && displayMessages.length === 0)" class="flex-1 flex flex-col pt-20 items-center justify-start gap-4">
      <div class="h-16 w-16 rounded-2xl bg-accent/20 animate-pulse"/>
      <div class="h-4 w-48 bg-accent/10 rounded animate-pulse"/>
      <p class="text-xs text-muted-foreground animate-pulse">Hydrating room timeline...</p>
    </div>

    <!-- Timeline -->
    <div v-else-if="isJoined" class="flex-1 flex overflow-y-scroll flex-col relative">
      <div 
        ref="timelineContainer" 
        class="flex-1 overflow-y-auto p-1 pb-10 min-h-0 flex flex-col-reverse gap-y-1 overflow-hidden"
      >
      <template v-for="(msg, index) in displayMessages" :key="msg.eventId">
        <!-- Call Event -->
        <div v-if="msg.isCallEvent" class="flex flex-col items-center my-6 animate-in fade-in slide-in-from-bottom duration-500">
          <div class="flex items-center gap-3 bg-muted/30 border border-border/50 rounded-2xl px-5 py-3 shadow-sm hover:bg-muted/40 transition-colors">
            <div class="h-9 w-9 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
              <Icon name="solar:phone-calling-bold" class="text-green-600 dark:text-green-500 h-5 w-5" />
            </div>
            <div class="flex flex-col">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-foreground">{{ msg.senderName }}</span>
                <span class="text-sm text-muted-foreground">started a voice call</span>
              </div>
              <span class="text-[10px] text-muted-foreground">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="ml-4 pl-4 border-l border-border/50">
              <UiButton size="sm" variant="outline" class="h-8 rounded-full text-xs font-semibold hover:bg-green-500/10 hover:text-green-600 hover:border-green-500/30 transition-all px-4" @click="handleJoinCall(toRaw(room) as any)">
                Join
              </UiButton>
            </div>
          </div>
        </div>

        <!-- Message bubble -->
        <div
          v-else
          :data-event-id="msg.eventId"
          class="flex flex-col gap-2.5 group items-start relative"
          :class="[
            msg.isOwn ? 'flex-row-reverse items-end' : 'flex-row items-start',
            (msg.reactions?.length || msg.readReceipts?.length) ? 'mb-4' : ''
          ]"
          @touchstart="onTouchStart"
          @touchend="(e) => onTouchEnd(e, { type: 'message', msg })"
        >
          <!-- Avatar & Metadata Column -->
          <div 
            class="flex flex-col shrink-0 gap-0.5 order-2 md:order-none"
            :class="[
              msg.isOwn ? 'items-end items-start text-right' : 'items-start text-left',
              // Ensure minimum width to maintain alignment even if avatar is missing/timestamp is small
              'min-w-[32px]'
            ]"
          >
            <!-- Avatar -->
            <MatrixAvatar 
              v-if="!isPreviousSameSender(index)"
              :mxc-url="msg.avatarUrl" 
              :name="msg.senderName" 
              class="h-8 w-8 border hidden md:block"
            />
            <!-- Spacer if no avatar but we still need the column to align (handled by flex parent alignment + min-width if timestamp is missing, but timestamp is always there) -->
            
            <!-- Timestamp & Edit Status -->
            <div 
              class="flex flex-col text-[10px] text-muted-foreground leading-none gap-0.5 mb-1 select-none"
            >
               <span v-if="msg.isEdited" class="whitespace-nowrap">
                 (edited)
               </span>
               <span class="whitespace-nowrap">
                 {{ formatTime(msg.timestamp) }}
               </span>
            </div>
          </div>

          <!-- Message content -->
          <div 
            v-long-press="() => { if (uiStore.hapticFeedbackEnabled) trigger('medium'); uiStore.openMessageContextMenu(msg); }"
            class="contents"
            @contextmenu.capture="uiStore.openMessageContextMenu(msg)"
          >
            <div class="flex flex-col max-w-[90%] md:max-w-[75%] min-w-0 relative group/message order-1 md:order-none" :class="msg.isOwn ? 'items-end' : 'items-start'">
              <!-- Sender name (only for first in a group) -->
              <span
                v-if="!msg.isOwn && !isPreviousSameSender(index)"
                class="text-xs font-medium text-muted-foreground mb-1 px-1"
              >
                {{ msg.senderName }}
              </span>

              <!-- Reply Preview (Outside Bubble) -->
              <div 
                v-if="msg.replyTo" 
                class="flex items-center gap-1.5 text-xs text-muted-foreground px-1 mt-1 cursor-pointer hover:text-muted-foreground transition-colors max-w-full"
                @click.stop="scrollToEvent(msg.replyTo.eventId)"
              >
                 <Icon name="solar:reply-bold" class="h-3 w-3 shrink-0 opacity-70" />
                 <span class="font-semibold shrink-0">{{ msg.replyTo.senderName }}:</span>
                 <span class="truncate min-w-0">{{ msg.replyTo.body }}</span>
              </div>
  
              <div
                v-if="msg.type === MsgType.Image"
                class="rounded-lg overflow-hidden flex flex-col items-end"
                :class="msg.isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'"
              >
                 <ChatFile 
                   :mxc-url="msg.url" 
                   :encrypted-file="msg.encryptedFile"
                   :alt="msg.body" 
                   :max-width="400"
                   :intrinsic-width="msg.imageWidth"
                   :intrinsic-height="msg.imageHeight"
                   :msgtype="msg.msgtype"
                   :mimetype="msg.mimetype"
                   :info="msg.info"
                   class="max-w-[400px]"
                 />
                 <div 
                   v-if="msg.showCaption"
                   class="rounded-2xl mt-1 px-3.5 py-2 text-sm w-fit leading-relaxed break-words whitespace-pre-wrap max-w-full"
                   style="overflow-wrap: anywhere"
                   :class="msg.isOwn
                     ? 'bg-primary text-primary-foreground rounded-br-md'
                     : 'bg-muted rounded-bl-md'"
                 >
                   {{ msg.body }}
                 </div>
              </div>
  
              <!-- Sticker (no bubble background, transparent) -->
              <div
                v-else-if="msg.type === 'm.sticker'"
                class="mt-1 flex flex-col"
                :class="msg.isOwn ? 'items-end' : 'items-start'"
              >
                 <ChatSticker 
                   :mxc-url="msg.url" 
                   :encrypted-file="msg.encryptedFile"
                   :alt="msg.body" 
                   class="max-w-[200px]"
                 />
              </div>
              
              <!-- Generic Files (Audio, Video, File) -->
              <div
                v-else-if="msg.isFile"
                class="mt-1 flex flex-col"
                :class="msg.isOwn ? 'items-end' : 'items-start'"
              >
                  <ChatFile
                    :mxc-url="msg.url"
                    :encrypted-file="msg.encryptedFile"
                    :alt="msg.body"
                    :msgtype="msg.msgtype"
                    :mimetype="msg.mimetype"
                    :info="msg.info"
                  />
              </div>

              <!-- Game Related (Board or Card) -->
              <div
                v-else-if="msg.isGameInvite || msg.isGameAction || msg.isGameOver"
                class="mt-1 flex flex-col"
                :class="msg.isOwn ? 'items-end' : 'items-start'"
              >
                <!-- Render Interactive Board ONLY for the latest event of this game -->
                <template v-if="msg.gameId && latestGameEventMap[msg.gameId] === msg.eventId && hasGameState(msg.gameId)" >
                   <TicTacToe 
                     v-if="getGameTypeFromState(msg.gameId) === 'tictactoe'"
                     :game-id="msg.gameId"
                     :room-id="(roomId as string)"
                     :class="msg.isOwn ? 'bg-primary/10' : 'bg-transparent'"
                   />
                   <Chess
                     v-else-if="getGameTypeFromState(msg.gameId) === 'chess'"
                     :game-id="msg.gameId"
                     :room-id="(roomId as string)"
                     :class="msg.isOwn ? 'bg-primary/10' : 'bg-transparent'"
                   />
                   <SlangTiles
                     v-else-if="getGameTypeFromState(msg.gameId) === 'slangtiles'"
                     :game-id="msg.gameId"
                     :room-id="(roomId as string)"
                     :class="msg.isOwn ? 'bg-primary/10' : 'bg-transparent'"
                   />
                   <div class="mt-2 w-full flex flex-col" :class="msg.isOwn ? 'items-end' : 'items-start'">
                     <GameActionBubble v-if="msg.isGameAction && getMatrixEvent(msg)" :event="getMatrixEvent(msg)!" />
                     <GameResultCard v-if="msg.isGameOver && getMatrixEvent(msg)" :event="getMatrixEvent(msg)!" />
                   </div>
                </template>
                
                <!-- Render Static Card for older events -->
                <template v-else>
                  <GameInviteCard v-if="msg.isGameInvite && getMatrixEvent(msg)" :event="getMatrixEvent(msg)!" />
                  <GameActionBubble v-else-if="msg.isGameAction && getMatrixEvent(msg)" :event="getMatrixEvent(msg)!" />
                  <GameResultCard v-else-if="msg.isGameOver && getMatrixEvent(msg)" :event="getMatrixEvent(msg)!" />
                </template>
              </div>

              <div
                v-else
                class="flex flex-col"
                :class="msg.isOwn ? 'items-end' : 'items-start'"
              >
                <div
                  class="rounded-2xl mt-1 px-3.5 py-2 overflow-hidden flex flex-col gap-1"
                  :class="msg.isOwn
                    ? 'bg-primary rounded-br-md text-primary-foreground'
                    : 'bg-muted border border-border/50 rounded-bl-md text-foreground'"
                >
                  <MessageContent 
                    v-if="!msg.isUrlOnly"
                    :body="msg.body" 
                    :formatted-body="msg.formattedBody" 
                    :is-own="msg.isOwn" 
                  />
                  <LinkPreview 
                    v-for="url in msg.urls"
                    :key="url"
                    :url="url"
                    :timestamp="msg.timestamp"
                    :is-own="msg.isOwn"
                  />
                </div>
              </div>

              <!-- Reactions -->
              <div 
                v-if="msg.reactions && msg.reactions.length > 0"
                class="absolute -bottom-3 flex gap-1 z-10"
                :class="msg.isOwn ? 'right-0 justify-end' : 'left-0 justify-start'"
              >
                  <UiTooltipProvider v-for="reaction in msg.reactions" :key="reaction.key">
                    <UiTooltip>
                      <UiTooltipTrigger as-child>
                        <UiBadge 
                          variant="secondary"
                          class="h-5 px-1.5 py-0 border border-background shadow-sm text-[10px] gap-1 hover:bg-muted cursor-pointer transition-colors"
                          :class="{ 'bg-blue-100 dark:bg-blue-900 border-blue-200 dark:border-blue-800': reaction.myReactionEventId }"
                          @click.stop="toggleReaction(msg, reaction.key, reaction.myReactionEventId)"
                        >
                            <span>{{ reaction.key }}</span>
                            <span v-if="reaction.count > 1" class="font-bold">{{ reaction.count }}</span>
                        </UiBadge>
                      </UiTooltipTrigger>
                      <UiTooltipContent side="top">
                        <p class="text-xs">{{ formatReactors(reaction.senders) }}</p>
                      </UiTooltipContent>
                    </UiTooltip>
                  </UiTooltipProvider>
              </div>
            </div>
          </div>

        <!-- Read Receipts -->
        <div
v-if="msg.readReceipts && msg.readReceipts.length > 0"
             class="flex absolute -bottom-5 gap-0.5 z-10"
             :class="msg.isOwn ? 'right-0' : 'left-0 justify-start'">
            <UiTooltipProvider v-for="receipt in msg.readReceipts" :key="receipt.userId">
              <UiTooltip>
                 <UiTooltipTrigger as-child>
                     <MatrixAvatar 
                       :mxc-url="receipt.avatarUrl"
                       :name="receipt.name"
                       class="h-4 w-4 border shadow-sm shrink-0"
                       :size="32"
                     />
                 </UiTooltipTrigger>
                  <UiTooltipContent side="top">
                    <p class="text-xs">Read by {{ receipt.name }}</p>
                  </UiTooltipContent>
              </UiTooltip>
            </UiTooltipProvider>
        </div>
        
        </div>

        <!-- Date separator (Now logic looks forward to next older message) -->
        <div
          v-if="index === displayMessages.length - 1 || !isSameDay(msg.timestamp, displayMessages[index + 1]?.timestamp || 0)"
          class="flex items-center gap-3 py-3 w-full"
        >
          <div class="flex-1 h-px bg-border" />
          <span class="text-xs text-muted-foreground font-medium shrink-0">
            {{ formatDate(msg.timestamp) }}
          </span>
          <div class="flex-1 h-px bg-border" />
        </div>

      </template>

      <!-- Infinite Scroll Trigger (Sentinel) -->
      <!-- In flex-col-reverse, the bottom of the HTML is the top of the screen -->
      <div ref="topSentinel" class="flex justify-center py-4 min-h-[40px] shrink-0 w-full">
        <div v-if="isLoadingHistory" class="flex items-center gap-2 text-muted-foreground">
           <Icon name="svg-spinners:ring-resize" class="h-5 w-5" />
           <span class="text-xs font-medium">Loading history...</span>
        </div>
        <span 
          v-else-if="!canLoadMore && messages.length > 0" 
          class="text-xs text-muted-foreground italic bg-muted/30 px-3 py-1 rounded-full"
        >
          You've gone as far back in time as you can
        </span>
      </div>

      <div v-if="messages.length === 0 && !isLoadingHistory" class="flex items-center justify-center h-full order-last">
        <p class="text-muted-foreground text-sm italic">"It's quiet here. Too quiet."</p>
      </div>
    </div>

    <!-- Event Source Viewer Dialog -->
    <UiAlertDialog :open="!!sourceEvent" @update:open="(val: boolean) => { if (!val) sourceEvent = null }">
      <UiAlertDialogContent class="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        <UiAlertDialogHeader class="p-6 border-b shrink-0 flex-row items-start justify-between text-left sm:text-left">
          <div class="flex flex-col gap-1">
            <UiAlertDialogTitle class="text-lg font-semibold flex items-center gap-2">
              <Icon name="solar:code-bold" class="h-5 w-5 text-primary" />
              Event Source
            </UiAlertDialogTitle>
            <UiAlertDialogDescription class="text-sm text-muted-foreground">
              Raw Matrix event data for debugging and inspection.
            </UiAlertDialogDescription>
          </div>
          <UiButton variant="ghost" size="icon" class="h-8 w-8 rounded-full shrink-0" @click="sourceEvent = null">
            <Icon name="solar:close-circle-bold" class="h-5 w-5" />
          </UiButton>
        </UiAlertDialogHeader>
        
        <div class="p-6 overflow-auto bg-muted/30 flex-1 min-h-0">
          <pre class="text-xs font-mono leading-relaxed select-all">{{ JSON.stringify(sourceEvent, null, 2) }}</pre>
        </div>

        <UiAlertDialogFooter class="p-4 border-t bg-muted/10 flex flex-row justify-end gap-3 sm:justify-end">
           <UiAlertDialogCancel as-child>
             <UiButton variant="outline">Close</UiButton>
           </UiAlertDialogCancel>
           <UiAlertDialogAction as-child @click="copyToClipboard(JSON.stringify(sourceEvent, null, 2))">
             <UiButton variant="default">Copy JSON</UiButton>
           </UiAlertDialogAction>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>
    </div>

    <!-- Message Composer -->
    <footer v-if="room && isJoined" class="flex-none p-4 border-t shrink-0">
      <div v-if="stagedFiles.length > 0" class="px-4 pb-3 flex gap-3 overflow-x-auto items-end">
        <div 
          v-for="(staged, index) in stagedFiles" 
          :key="staged.previewUrl" 
          class="relative group shrink-0"
        >
          <img 
            v-if="staged.file.type.startsWith('image/')"
            :src="staged.previewUrl" 
            class="h-24 w-24 object-cover rounded-xl border-2 border-border shadow-sm" 
          >
          <div v-else class="h-24 w-24 rounded-xl border-2 border-border bg-muted flex flex-col items-center justify-center gap-1 p-2 text-center">
            <Icon name="solar:file-bold" class="h-8 w-8 text-muted-foreground" />
            <span class="text-[10px] text-muted-foreground truncate w-full">{{ staged.file.name }}</span>
          </div>
          
          <button 
            class="absolute -top-2 -right-2 bg-background border border-border hover:bg-destructive hover:text-destructive-foreground text-foreground rounded-full p-1 transition-colors"
            title="Remove attachment"
            @click.prevent="removeStagedFile(index)"
          >
             <Icon name="solar:close-circle-bold" class="h-4 w-4" />
          </button>
        </div>
      </div>
      <!-- Reply / Edit Indicator -->
      <div v-if="replyingTo || editingMessage" class="px-4 pb-2 flex items-center justify-between text-sm text-muted-foreground bg-muted/30">
        <div class="flex items-center gap-2 overflow-hidden">
          <Icon v-if="replyingTo" name="solar:reply-bold" class="h-4 w-4" />
          <Icon v-else name="solar:pen-bold" class="h-4 w-4" />
          <span class="truncate">
            <template v-if="replyingTo">
                 Replying to <strong>{{ replyingTo.senderName }}</strong>: {{ replyingTo.body }}
            </template>
            <template v-else>
                 Editing message
            </template>
          </span>
        </div>
        <button class="p-1 hover:bg-muted rounded-full" @click="cancelAction">
            <Icon name="solar:close-circle-bold" class="h-4 w-4" />
        </button>
      </div>

      <form @submit.prevent="sendMessage">
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          @change="handleFileSelect"
        >
        <UiInputGroup class="bg-background rounded-2xl flex items-end p-1 gap-1">
          <UiInputGroupAddon align="inline-start">
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiInputGroupButton 
                  class="relative rounded-full shrink-0"
                  size="icon-sm"
                  variant="outline">
                  <Icon name="solar:menu-dots-bold" />
                </UiInputGroupButton>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="start">
                <UiDropdownMenuItem class="cursor-pointer" @click="triggerFileUpload">
                  <Icon name="solar:file-send-linear" />
                  <span>Upload File</span>
                </UiDropdownMenuItem>
                <UiDropdownMenuSub>
                  <UiDropdownMenuSubTrigger class="cursor-pointer">
                    <Icon name="solar:gamepad-linear" />
                    <span>Play Game</span>
                  </UiDropdownMenuSubTrigger>
                  <UiDropdownMenuPortal>
                    <UiDropdownMenuSubContent>
                      <UiDropdownMenuItem class="cursor-pointer" @click="handleInviteToGame('tictactoe')">
                        <span>Tic-Tac-Toe</span>
                      </UiDropdownMenuItem>
                      <UiDropdownMenuItem class="cursor-pointer" @click="handleInviteToGame('chess')">
                        <span>Chess</span>
                      </UiDropdownMenuItem>
                      <UiDropdownMenuItem class="cursor-pointer" @click="handleInviteToGame('slangtiles')">
                        <span>Slanguage Tiles</span>
                      </UiDropdownMenuItem>
                    </UiDropdownMenuSubContent>
                  </UiDropdownMenuPortal>
                </UiDropdownMenuSub>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem disabled>
                  <Icon name="solar:chart-square-linear" />
                  <span>Poll (Coming Soon)</span>
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </UiInputGroupAddon>

          <UiInputGroupTextarea
            ref="textareaRef"
            v-model="newMessage"
            placeholder="Type a message..."
            rows="1" 
            class="min-h-10 max-h-[200px] resize-none border-0 focus-visible:ring-0 py-2.5 flex-1 text-base"
            @keydown="handleKeydown"
            @input="autoResize"
            @paste="handlePaste"
          />
          <UiInputGroupAddon align="inline-end">
            <UiInputGroupButton
              type="submit" 
              class="rounded-full shrink-0"
              variant="default"
              :disabled="!canSend" 
              size="icon-sm">
              <Icon v-if="editingMessage" name="solar:check-read-linear" />
              <Icon v-else name="solar:plain-bold" />
            </UiInputGroupButton>
          </UiInputGroupAddon>
        </UiInputGroup>
      </form>
    </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IRoomTimelineData, MatrixClient, RoomEvent, EventType, MsgType, MatrixEventEvent, ClientEvent, MatrixEvent, Room, RoomMember, Direction, TimelineWindow, RelationType } from 'matrix-js-sdk';
import { toast } from 'vue-sonner';
import { ref, shallowRef, markRaw, toRaw, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import ChatSticker from '~/components/ChatSticker.vue';
import ChatFile from '~/components/ChatFile.vue';
import GameInviteCard from './game/GameInviteCard.vue';
import GameActionBubble from './game/GameActionBubble.vue';
import GameResultCard from './game/GameResultCard.vue';
import TicTacToe from './game/TicTacToe.vue';
import Chess from './game/Chess.vue';
import SlangTiles from './game/SlangTiles.vue';
import EmojiPicker from 'vue3-emoji-picker';
import 'vue3-emoji-picker/css';
import { Room as LiveKitRoom, RoomEvent as LKRoomEvent, Track as LKTrack, BaseKeyProvider as BaseE2EEKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client';
import { isVoiceChannel } from '~/utils/room';
import MatrixVoiceCall from '~/components/MatrixVoiceCall.vue';
import RoomHeader from '~/components/RoomHeader.vue';
import IncomingCallBanner from '~/components/IncomingCallBanner.vue';
import { useVoiceStore } from '~/stores/voice';
import KeychainWarningDialog from '~/components/KeychainWarningDialog.vue';
import { useJoinCall } from '~/composables/useJoinCall';
import { useWebHaptics } from 'web-haptics/vue';


function extractUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<]+[^.,\s<]/gi;
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : []; // Return unique URLs
}

function isUrlOnly(text: string): boolean {
  if (!text) return false;
  const urls = extractUrls(text);
  if (urls.length === 0) return false;
  
  // Check if text contains only URLs and whitespace
  let remainingText = text;
  urls.forEach(url => {
    remainingText = remainingText.replace(url, '');
  });
  
  return remainingText.trim().length === 0;
}


const props = defineProps<{
  isDm?: boolean;
}>();

const route = useRoute();
const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const activityStore = useActivityStore();
const presenceStore = usePresenceStore();
const { trigger } = useWebHaptics({
  debug: uiStore.hapticsDebugEnabled
});
const { onTouchStart, onTouchEnd } = useMobileGestures();
const voiceStore = useVoiceStore();
const { showKeychainWarning, handleJoinCall, handleProceed, handleCancel } = useJoinCall();
const isCallUiHidden = ref(false);

async function handleInviteToGame(gameType: string = 'tictactoe') {
  console.log(`[Chat] Invite to ${gameType} requested`, { roomId: roomId.value, otherUserId: otherUserId.value });
  
  if (!roomId.value) {
    toast.error('No room selected');
    return;
  }

  // Fallback for non-DM rooms: invite the first other joined member
  let targetUserId = otherUserId.value;
  if (!targetUserId && room.value) {
    const myUserId = store.client?.getUserId();
    const members = room.value.getJoinedMembers();
    const otherMember = members.find(m => m.userId !== myUserId);
    targetUserId = otherMember?.userId;
    console.log('[Chat] Non-DM room detected, selecting target user:', targetUserId);
  }

  if (!targetUserId) {
    toast.error('Cannot find an opponent in this room');
    return;
  }

  const { inviteToGame } = useMatrixGame(roomId.value!);
  try {
    await inviteToGame(gameType, targetUserId);
    toast.success('Game invite sent');
  } catch (err) {
    console.error('Failed to send game invite', err);
    toast.error('Failed to send game invite');
  }
}

function hasGameState(gameId: string): boolean {
  activityStore.gameTrigger; // reactivity
  return !!activityStore.gameStates[gameId];
}

function getGameTypeFromState(gameId: string): string | undefined {
  activityStore.gameTrigger; // reactivity
  return activityStore.gameStates[gameId]?.game_type;
}

// --- Reactive state ---

interface ChatMessage {
  eventId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  avatarUrl: string | null;
  body: string;
  formattedBody?: string;
  timestamp: number;
  isOwn: boolean;
  type: string;
  url?: string;
  encryptedFile?: any;
  filename?: string;
  showCaption?: boolean;
  imageWidth?: number;
  imageHeight?: number;
  isEdited?: boolean;
  urls?: string[];
  isUrlOnly?: boolean;
  replyTo?: {
    eventId: string;
    senderName: string;
    body: string;
  };
  reactions?: {
    key: string;
    count: number;
    senders: string[];
    myReactionEventId?: string; // If the current user reacted, store the event ID here for redaction
  }[];
  readReceipts?: {
    userId: string;
    avatarUrl: string | null;
    name: string;
    ts: number;
  }[];
  isFile?: boolean;
  msgtype?: string;
  mimetype?: string;
  info?: any;
  isCallEvent?: boolean;
  gameId?: string;
  gameType?: string;
  isGameInvite?: boolean;
  isGameAction?: boolean;
  isGameOver?: boolean;
  rawEvent?: MatrixEvent;
  roomId?: string;
}

function getMatrixEvent(msg: ChatMessage): MatrixEvent | undefined {
  return msg.rawEvent;
}

const messages = ref<ChatMessage[]>([]);
const newMessage = computed({
  get: () => uiStore.composerStates[roomId.value ?? '']?.text || '',
  set: (val: string) => {
    if (roomId.value) {
      uiStore.setUIComposerState(roomId.value as string, { text: val });
    }
  }
});
const isSending = ref(false);
const isLoadingHistory = ref(false);
const isRecording = ref(false);
const showEmojiPicker = ref(false);
const showReactionPickerMap = ref<Record<string, boolean>>({}); // Track which message has its reaction picker open
const typingUsers = ref<string[]>([]);
let typingTimeout: NodeJS.Timeout | null = null;
let lastTypingTime = 0;
const TYPING_TIMEOUT = 5000;

// Computed
const room = ref<Room | null>(null);
const myMembership = ref<string | null>(null);
const timelineContainer = ref<HTMLElement | null>(null);
const timelineWindow = ref<TimelineWindow | null>(null);
const decryptionListenerIds = new Set<string>(); // Track events with registered decryption listeners
const topSentinel = ref<HTMLElement | null>(null);
const sourceEvent = ref<any>(null);
let observer: IntersectionObserver | null = null;
let lastRoomId: string | undefined = undefined;

// --- Computed ---

const roomId = computed(() => {
  const params = route.params.id;
  if (Array.isArray(params)) {
    // For space routes like /chat/spaces/[spaceId]/[roomId], the actual room we want to load
    // is the last segment of the catch-all route.
    return params[params.length - 1];
  }
  return params;
});

// Create a reactive, newest-first array for the template
const displayMessages = computed(() => {
  return messages.value.map(msg => ({
    ...msg,
    urls: extractUrls(msg.body),
    isUrlOnly: isUrlOnly(msg.body)
  } as ChatMessage)).reverse();
});

const latestGameEventMap = computed(() => {
  const map: Record<string, string> = {};
  for (const msg of messages.value) {
    if (msg.gameId) {
      map[msg.gameId] = msg.eventId;
    }
  }
  return map;
});

const roomAvatarUrl = computed(() => {
  if (!room.value || !store.client) return null;
  const mxc = room.value.getMxcAvatarUrl();
  if (mxc) return mxc;

  if (props.isDm) {
    // Fallback: find the other member in this DM
    const myUserId = store.client.getUserId();
    // Use current state members to be safe, though getJoinedMembers is usually fine
    const members = room.value.getJoinedMembers();
    const otherMember = members.find(m => m.userId !== myUserId);
    
    return otherMember?.getMxcAvatarUrl() || null;
  }
  
  return null;
});

const roomTopic = computed(() => {
  if (!room.value) return '';
  const topicEvent = room.value.currentState.getStateEvents('m.room.topic', '');
  return topicEvent?.getContent()?.topic || '';
});

const otherUserId = computed(() => {
  if (!props.isDm || !room.value || !store.client) return undefined;
  const myUserId = store.client.getUserId();
  const members = room.value.getMembers(); // Include invites/left members
  return members.find(m => m.userId !== myUserId)?.userId;
});

const isJoined = computed(() => myMembership.value === 'join');
const isInvited = computed(() => myMembership.value === 'invite');

const inviterName = computed(() => {
  if (!room.value || !isInvited.value) return null;
  const inviterId = room.value.getDMInviter();
  if (!inviterId) return null;
  return room.value.getMember(inviterId)?.name || inviterId;
});

const canSend = computed(() => {
  return (newMessage.value.trim().length > 0 || stagedFiles.value.length > 0) && !isSending.value;
});
// --- Helpers ---

function mapEvent(event: MatrixEvent): ChatMessage | null {
  const type = event.getType();
  
  if (event.isRelation(RelationType.Replace) || event.isRedacted()) {
      return null;
  }

  const isEncrypted = type === 'm.room.encrypted';

  // getContent() automatically returns the *edited* content if replaced
  const content = isEncrypted ? event.getClearContent() : event.getContent();
  
  // If we don't have content and it's NOT encrypted, it's a malformed event we should skip.
  // If it IS encrypted but we have no content, it's a decryption failure (or pending).
  if (!content && !isEncrypted) return null;

  const isDecryptionError = isEncrypted && !content;
  const contentSafe: any = content || {};

  const isMessage = type === EventType.RoomMessage;
  const isSticker = type === 'm.sticker';
  const isRTC = type === 'org.matrix.msc3401.call.member' || type === 'm.call.member' || type === 'm.rtc.member';
  const isGameInvite = type === EventType.RoomMessage && contentSafe.msgtype === 'cc.jackg.ruby.game.invite';
  const isGameAction = type === 'cc.jackg.ruby.game.action';
  const isGameOver = type === 'cc.jackg.ruby.game.over';
  const isGameState = type === 'cc.jackg.ruby.game.state';

  // We allow these events through the first filter so they can be processed, 
  // but we might still return null if we don't want them in the visual timeline.
  if (!isMessage && !isEncrypted && !isSticker && !isRTC && !isGameInvite && !isGameAction && !isGameOver && !isGameState) return null;
  
  // Don't show game state events in the visual timeline (they just update the board)
  if (isGameState) return null;

  // Events that require a body (text, images, files, etc)
  const isContentMessage = isMessage || isEncrypted || isSticker;
  const isGameTimelineEvent = isGameInvite || isGameAction || isGameOver;
  
  // If it's a message event but has no body, and it's NOT encrypted, skip it.
  // If it IS encrypted and has no body (decryption error), we WANT to show it as a placeholder.
  if (isContentMessage && !isRTC && !isGameTimelineEvent && !contentSafe.body && !isDecryptionError) return null;

  const senderId = event.getSender() || '';
  const senderMember = room.value?.getMember(senderId);
  const senderName = senderMember?.name || senderId;

  let avatarUrl: string | null = null;
  const mxcAvatar = senderMember?.getMxcAvatarUrl();
  if (mxcAvatar && store.client) {
    avatarUrl = mxcAvatar;
  }

  if (isRTC) {
    // Only show the event if it's a "join" (membership present)
    const memberships = contentSafe.memberships || [];
    if (memberships.length === 0) return null;

    return {
      eventId: event.getId()!,
      senderId,
      senderName,
      senderInitials: senderName.substring(0, 1),
      avatarUrl,
      body: 'started a call',
      timestamp: event.getTs(),
      isOwn: senderId === store.client?.getUserId(),
      type: 'm.rtc.member',
      isCallEvent: true
    };
  }

  if (isGameInvite) {
    return {
      eventId: event.getId()!,
      senderId,
      senderName,
      senderInitials: senderName.substring(0, 1),
      avatarUrl,
      body: contentSafe.body || 'Game Invite',
      timestamp: event.getTs(),
      isOwn: senderId === store.client?.getUserId(),
      type: contentSafe.msgtype || '',
      isGameInvite: true,
      gameId: contentSafe.game_id,
      gameType: contentSafe.game_type,
      rawEvent: event
    };
  }

  if (isGameAction) {
    return {
      eventId: event.getId()!,
      senderId,
      senderName,
      senderInitials: senderName.substring(0, 1),
      avatarUrl,
      body: 'Game Action',
      timestamp: event.getTs(),
      isOwn: senderId === store.client?.getUserId(),
      type: 'cc.jackg.ruby.game.action',
      isGameAction: true,
      gameId: contentSafe.game_id,
      rawEvent: event
    };
  }

  if (isGameOver) {
    return {
      eventId: event.getId()!,
      senderId,
      senderName,
      senderInitials: senderName.substring(0, 1),
      avatarUrl,
      body: 'Game Over',
      timestamp: event.getTs(),
      isOwn: senderId === store.client?.getUserId(),
      type: 'cc.jackg.ruby.game.over',
      isGameOver: true,
      gameId: contentSafe.game_id,
      rawEvent: event
    };
  }

  // extract filename if available
  // content.filename is common, or content.file?.name (for encrypted)
  let filename = contentSafe.filename;
  if (!filename && contentSafe.file && contentSafe.file.name) {
      filename = contentSafe.file.name;
  }
  
  // Determine if caption should be shown
  let showCaption = !!contentSafe.body;
  
  // If we have a filename, don't show if simple match
  if (filename && contentSafe.body === filename) {
    showCaption = false;
  }
  
  // Heuristic: If we don't have a filename (or even if we do), 
  // if the body looks looks like a strict filename (extension, no spaces), hide it.
  // This covers cases where filename metadata is missing but body is "IMG_1234.JPG"
  const isLikelyFilename = contentSafe.body && /\.(png|jpe?g|gif|webp)$/i.test(contentSafe.body) && !/\s/.test(contentSafe.body);
  if (!filename && isLikelyFilename) {
    showCaption = false;
  }

  // Check if edited
  const isEdited = !!event.replacingEvent();

  // Check if reply since we already have content
  let replyTo: ChatMessage['replyTo'] | undefined;
  const relation = contentSafe['m.relates_to']; // Direct content access is more reliable for raw structure
  
  if (relation && relation['m.in_reply_to']) {
    const replyEventId = relation['m.in_reply_to'].event_id;
    if (replyEventId) {
       const replyEvent = room.value?.findEventById(replyEventId);
       if (replyEvent) {
         const replyContent = replyEvent.getContent() || {};
         const replySenderId = replyEvent.getSender() || '';
         const replySender = room.value?.getMember(replySenderId)?.name || replySenderId;
         replyTo = {
           eventId: replyEventId,
           senderName: replySender,
           body: replyContent.body || 'Attachment',
         };
       } else {
         // Event not locally available
         replyTo = {
             eventId: replyEventId,
             senderName: 'Unknown',
             body: 'Message loading...',
         };
       }
    }
  }

  // Extract reactions
  const reactions: ChatMessage['reactions'] = [];
  const myUserId = store.client?.getUserId();
  
  // 1. Try server aggregated (for old events)
  const serverRelations = event.getServerAggregatedRelation<any>('m.annotation');
  if (serverRelations && serverRelations.chunk) {
      serverRelations.chunk.forEach((reaction: any) => {
        if (reaction.type === 'm.reaction') {
            const existing = reactions.find(r => r.key === reaction.key);
            if (existing) {
                existing.count = reaction.count || existing.count;
            } else {
                reactions.push({
                    key: reaction.key,
                    count: reaction.count || 1,
                    senders: [], // Server aggregation rarely gives full sender list
                    // We can't know if *we* reacted from just the count aggregation easily without checking the full chunk if available
                    // But often the chunk is just { count: 2, key: '👍' }
                });
            }
        }
      });
  } 
  
  // 2. Try local relations (for recent events/local echo AND finding own reaction ID)
  // We need to access the relations container to find if WE reacted
  if (room.value) {
      const timelineSet = room.value.getUnfilteredTimelineSet();
      // Access relations via the relations container property
      const relationsContainer = timelineSet.relations?.getChildEventsForEvent(event.getId()!, 'm.annotation', 'm.reaction');
      
      if (relationsContainer) {
          const sortedAnnotations = relationsContainer.getSortedAnnotationsByKey();
          if (sortedAnnotations) {
              sortedAnnotations.forEach(([key, events]) => {
                  if (events.size > 0) {
                      let myReactionId: string | undefined;
                      const senders: string[] = [];
                      
                      events.forEach(ev => {
                          const sender = ev.getSender();
                          if (sender) senders.push(sender);
                          if (sender === myUserId) {
                              myReactionId = ev.getId();
                          }
                      });

                      const existing = reactions.find(r => r.key === key);
                      if (existing) {
                          existing.count = events.size;
                          existing.senders = senders;
                          existing.myReactionEventId = myReactionId;
                      } else {
                          reactions.push({
                              key: key,
                              count: events.size,
                              senders: senders,
                              myReactionEventId: myReactionId,
                          });
                      }
                  }
              });
          }
      }
  }

  // 3. Fallback for server aggregation limitation: 
  // If we found a reaction via server aggregation but didn't find it in local relations (unlikely if we just synced),
  // we might miss our own reaction ID. 
  // However, for the purpose of "toggle", if we can't find our reaction ID, we assume we haven't reacted 
  // (or at least we can't redact it easily without searching history).
  // Current logic prioritizes local relations which is correct for active sessions.
  // Check if it's a generic file (m.file, m.video, m.audio) or fallback with url/file
  const fileMsgTypes = [MsgType.File, MsgType.Video, MsgType.Audio] as string[];
  let isFile = false;
  
  if (!isSticker && (isMessage || isEncrypted)) {
    if (contentSafe.msgtype && fileMsgTypes.includes(contentSafe.msgtype as string)) {
      isFile = true;
    } else if (contentSafe.msgtype !== MsgType.Image && contentSafe.msgtype !== MsgType.Text && contentSafe.msgtype !== MsgType.Notice && contentSafe.msgtype !== MsgType.Emote) {
      // Fallback for custom file types if they have a URL or encrypted file but aren't explicitly text/images
      if (contentSafe.url || contentSafe.file) {
        isFile = true;
      }
    }
  }

  // Extract read receipts
  const readReceipts: ChatMessage['readReceipts'] = [];
  if (room.value) {
      const receipts = room.value.getReceiptsForEvent(event);
      const uniqueReaders = new Set<string>();
      
      receipts.forEach(r => {
          // We exclude the event sender from their own message's read receipts
          if (r.type === 'm.read' && r.userId !== senderId && !uniqueReaders.has(r.userId)) {
              uniqueReaders.add(r.userId);
              
              let avatarUrl = null;
              let name = r.userId;
              
              const readMember = room.value?.getMember(r.userId);
              if (readMember) {
                  name = readMember.name;
                  avatarUrl = readMember.getMxcAvatarUrl() || null;
              } else {
                  const readUser = store.client?.getUser(r.userId);
                  if (readUser) {
                      name = readUser.displayName || r.userId;
                      avatarUrl = readUser.avatarUrl || null;
                  }
              }

              readReceipts.push({
                  userId: r.userId,
                  avatarUrl,
                  name,
                  ts: r.data.ts || 0
              });
          }
      });
  }

  return {
    eventId: event.getId() || '',
    roomId: event.getRoomId(),
    senderId,
    senderName,
    senderInitials: senderName.replace(/^[@!]/, '').slice(0, 2).toUpperCase(),
    avatarUrl,
    body: contentSafe.body || (isDecryptionError ? 'Encryption error: This message cannot be decrypted.' : ''),
    // Strip the reply fallback from body when formatted HTML is available
    formattedBody: contentSafe.format === 'org.matrix.custom.html' ? contentSafe.formatted_body : undefined,
    timestamp: event.getTs(),
    isOwn: senderId === store.client?.getUserId(),
    type: isSticker ? 'm.sticker' : (contentSafe.msgtype || MsgType.Text),
    url: contentSafe.url,
    encryptedFile: contentSafe.file,
    filename,
    showCaption,
    imageWidth: contentSafe.info?.w,
    imageHeight: contentSafe.info?.h,
    isEdited,
    replyTo,
    reactions: reactions.length > 0 ? reactions : undefined,
    readReceipts: readReceipts.length > 0 ? readReceipts : undefined,
    isFile,
    msgtype: contentSafe.msgtype,
    mimetype: contentSafe.info?.mimetype,
    info: contentSafe.info,
  };
}

/**
 * Rebuild the messages array entirely from the TimelineWindow.
 * This is the ONLY function that should mutate `messages.value`.
 */
function refreshMessagesFromWindow() {
  if (!timelineWindow.value) return;

  const events = timelineWindow.value.getEvents();
  const newMessages: ChatMessage[] = [];

  for (const event of events) {
    if (event.isEncrypted() && !event.getClearContent()) {
      const eventId = event.getId();
      if (eventId && !decryptionListenerIds.has(eventId)) {
        decryptionListenerIds.add(eventId);
        event.once(MatrixEventEvent.Decrypted, () => {
          decryptionListenerIds.delete(eventId!);
          refreshMessagesFromWindow();
          // Force game re-evaluation in case this was a game event
          activityStore.gameTrigger++;
        });
      }
    }
    const mapped = mapEvent(event);
    if (mapped) {
      newMessages.push(mapped);
    }
  }

  messages.value = newMessages;
}

function isPreviousSameSender(index: number): boolean {
  // We are looking at the newest-first displayMessages array
  const current = displayMessages.value[index];
  const older = displayMessages.value[index + 1]; // The message visually ABOVE it
  
  if (!current || !older) return false;
  
  return current.senderId === older.senderId
    && isSameDay(current.timestamp, older.timestamp);
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (isSameDay(ts, now.getTime())) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(ts, yesterday.getTime())) return 'Yesterday';

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function forceScrollToBottom() {
  nextTick(() => {
    const el = timelineContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function sendReadReceipt(event: MatrixEvent) {
  if (!room.value || !store.client) return;
  // Don't send read receipts for local echoes (events without a server-assigned ID)
  if (event.status !== null) return;
  store.client?.sendReadReceipt(event);
}

// --- Pagination (TimelineWindow) ---

const canLoadMore = computed(() => !!timelineWindow.value?.canPaginate(Direction.Backward));

async function loadMoreMessages() {
  if (!timelineWindow.value || isLoadingHistory.value) return;
  
  if (!timelineWindow.value.canPaginate(Direction.Backward)) {
    return;
  }

  isLoadingHistory.value = true;

  try {
    await timelineWindow.value.paginate(Direction.Backward, 20);
    refreshMessagesFromWindow(); 
  } catch (err) {
    console.error('Failed to load history:', err);
  } finally {
    isLoadingHistory.value = false;
  }
}

// --- Live message handler ---

function processEventForStore(event: MatrixEvent) {
  const isEncrypted = event.getType() === 'm.room.encrypted';
  const content = isEncrypted ? event.getClearContent() : event.getContent();
  const type = isEncrypted ? content?.type : event.getType();

  if (type === 'cc.jackg.ruby.game.state' && content?.game_id) {
    activityStore.updateGameState(content.game_id, content);
  }
}

function onTimelineEvent(
  event: MatrixEvent,
  eventRoom: Room | undefined,
  toStartOfTimeline: boolean | undefined,
  _removed: boolean,
  _data: IRoomTimelineData,
) {
  if (toStartOfTimeline) return; // Handled by pagination
  if (!eventRoom || eventRoom.roomId !== roomId.value) return;
  if (!timelineWindow.value) return;

  // Process for global store side-effects (e.g. game state)
  processEventForStore(event);

  // Extend the window forward to absorb any new live event(s)
  timelineWindow.value.extend(Direction.Forward, 20);

  // Rebuild messages from the window (single source of truth)
  refreshMessagesFromWindow();

  sendReadReceipt(event);
}

function onRedactionEvent(event: MatrixEvent, _room: Room) {
  if (event.getRoomId() === roomId.value) {
    refreshMessagesFromWindow();
  }
}

function onLocalEchoUpdated(event: MatrixEvent, _room: Room, _oldEventId?: string, _newStatus?: any) {
  if (event.getRoomId() === roomId.value) {
    refreshMessagesFromWindow();
  }
}

function onReceiptEvent(event: MatrixEvent, triggeredRoom: Room) {
  if (room.value && triggeredRoom.roomId === room.value.roomId) {
      refreshMessagesFromWindow();
  }
}

function onMyMembership(triggeredRoom: Room, membership: string) {
  if (room.value && triggeredRoom.roomId === room.value.roomId) {
    console.log(`[Chat] Membership changed to ${membership} for ${triggeredRoom.roomId}`);
    myMembership.value = membership;
    
    // If we just joined, re-init the room to load history/members
    if (membership === 'join') {
      initRoom();
    }
  }
}

function scrollToEvent(eventId: string) {
    if (!timelineContainer.value) return;
    
    const el = timelineContainer.value.querySelector(`[data-event-id="${eventId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight effect?
        el.classList.add('bg-accent/20');
        setTimeout(() => el.classList.remove('bg-accent/20'), 2000);
    } else {
        toast.info('Message not in current view');
    }
}

// --- File Upload ---

const fileInput = ref<HTMLInputElement | null>(null);
const textareaRef = ref<any>(null);

interface StagedFile {
  file: File;
  previewUrl: string;
}

const stagedFiles = ref<StagedFile[]>([]);

function removeStagedFile(index: number) {
  const staged = stagedFiles.value[index];
  if (!staged) return;

  // Free up browser memory
  URL.revokeObjectURL(staged.previewUrl);
  stagedFiles.value.splice(index, 1);
}

async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;

  let addedImage = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        stagedFiles.value.push({
          file,
          previewUrl: URL.createObjectURL(file)
        });
        addedImage = true;
      }
    }
  }
  
  // Prevent the default paste behavior (pasting the filename as text) ONLY if we grabbed an image
  if (addedImage) {
    event.preventDefault();
  }
}

async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;
  
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i];
    if (file) {
      stagedFiles.value.push({
        file,
        // For non-images, you might want to show a generic icon, but URL.createObjectURL still works safely
        previewUrl: URL.createObjectURL(file) 
      });
    }
  }

  input.value = ''; // Reset input
}

function triggerFileUpload() {
  fileInput.value?.click();
}

async function onRoomMemberTyping(event: MatrixEvent, member: RoomMember) {
    if (member.roomId !== room.value?.roomId) return;
    
    // Refresh the typing list based on current room members who are typing
    const members = room.value?.getMembersWithMembership('join') || [];
    const typing = members
        .filter(m => m.typing && m.userId !== store.client?.getUserId())
        .map(m => m.name || m.userId);
        
    typingUsers.value = typing;
}

const autoResize = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
  
  // 1. Reset height to 'auto' so it can shrink if the user deletes text
  target.style.height = 'auto';
  
  // 2. Set the height to match the scrollable content
  target.style.height = `${target.scrollHeight}px`;
  
  // 3. Call your existing typing handler
  handleTypingInput();
}

async function handleTypingInput() {
    if (!room.value || !store.client) return;

    const now = Date.now();
    // Don't send too frequently (throttle to once per second) to avoid spamming server
    if (now - lastTypingTime > 1000) {
        store.client.sendTyping(room.value.roomId, true, TYPING_TIMEOUT);
        lastTypingTime = now;
    }
    
    // Always reset the auto-cancel timer on input
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        if (room.value && store.client) {
            store.client.sendTyping(room.value.roomId, false, 0);
        }
    }, TYPING_TIMEOUT);
}

// Inside <script setup>

function handleKeydown(e: KeyboardEvent) {
  // Only intercept if the Enter key is pressed
  if (e.key === 'Enter') {
    // Robust mobile detection: checks UserAgent OR if the device has a touch screen
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
      || ('ontouchstart' in window) 
      || navigator.maxTouchPoints > 0;

    if (isMobile) {
      // Mobile: Do nothing. Let the native Enter behavior (new line) happen.
      return; 
    }

    // Desktop: Check if Shift is being held down
    if (!e.shiftKey) {
      e.preventDefault(); // Stop the new line from forming
      sendMessage();      // Send the message
    }
    // If Shift IS held down on desktop, it skips the `if` block 
    // and naturally creates a new line.
  }
}

// --- Send message ---

async function sendMessage() {
  if (!canSend.value || !store.client) return;
  if (uiStore.hapticFeedbackEnabled) trigger('light');
  
  const text = newMessage.value.trim();
  const filesToSend = [...stagedFiles.value]; // Copy array
  
  const currentReply = replyingTo.value;
  const currentEdit = editingMessage.value;

  // Optimistically clear input UI immediately
  newMessage.value = '';
  stagedFiles.value = [];
  if (textareaRef.value) {
    const el = textareaRef.value.$el || textareaRef.value;
    const ta = el instanceof HTMLTextAreaElement ? el : el.querySelector('textarea');
    if (ta) ta.style.height = 'auto';
  }
  
  replyingTo.value = null;
  editingMessage.value = null;
  isSending.value = true;

  const currentRoomId = roomId.value as string;
  if (!currentRoomId) return;

  try {
    // 1. Upload and send any staged files first
    for (const staged of filesToSend) {
      await matrixService.uploadFile(currentRoomId, staged.file);
      URL.revokeObjectURL(staged.previewUrl); // Clean up memory
    }

    // 2. Send the text message (if there is one)
    if (text) {
      if (currentEdit) {
        await matrixService.sendEdit(currentRoomId, currentEdit.eventId, text);
      } else if (currentReply) {
        await matrixService.sendReply(currentRoomId, currentReply.eventId, text);
      } else {
        await matrixService.sendTextMessage(currentRoomId, text);
      }
    }
  } catch (err) {
    console.error('Failed to send message:', err);
    // Restore message and states on failure so the user doesn't lose their work
    newMessage.value = text;
    stagedFiles.value = filesToSend; // Put files back in the staging area
    if (currentEdit) editingMessage.value = currentEdit;
    if (currentReply) replyingTo.value = currentReply;
    
    toast.error('Failed to send message');
  } finally {
    isSending.value = false;
  }
}

// --- Lifecycle ---

async function refreshRoomUI() {
    if (!roomId.value) return;
    await matrixService.refreshRoom(roomId.value);
    await initRoom();
}

function setupObserver() {
  if (observer) observer.disconnect();
  
  observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry && entry.isIntersecting && canLoadMore.value && !isLoadingHistory.value) {
      loadMoreMessages();
    }
  }, {
    root: timelineContainer.value, 
    rootMargin: '200px 0px 0px 0px', 
    threshold: 0.1
  });

  if (topSentinel.value) {
    observer.observe(topSentinel.value);
  }
}

watch(topSentinel, (newEl) => {
  if (newEl) {
    setupObserver();
  } else if (observer) {
    observer.disconnect();
  }
});

function checkAndApplyPendingShare() {
  if (uiStore.pendingShare) {
    const share = uiStore.pendingShare;
    console.log('[Chat] Applying pending share to composer:', share);

    // Combine title, text, and URL
    const parts = [];
    if (share.title) parts.push(share.title);
    if (share.text) parts.push(share.text);
    if (share.url) parts.push(share.url);

    if (parts.length > 0) {
      const combined = parts.join('\n');
      if (newMessage.value) {
        newMessage.value += '\n\n' + combined;
      } else {
        newMessage.value = combined;
      }
    }

    // Handle files
    if (share.files && share.files.length > 0) {
      for (const fileData of share.files) {
        // Convert Blob back to File to preserve name and type for Matrix upload
        const file = new File([fileData.blob], fileData.name, { type: fileData.type });
        stagedFiles.value.push({
          file: file,
          previewUrl: URL.createObjectURL(file)
        });
      }
    }

    // Clear it
    uiStore.pendingShare = null;

    // Focus the textarea
    nextTick(() => {
        textareaRef.value?.$el?.focus();
    });
  }
}

async function initRoom() {
  if (!store.client) return;
  const r = store.client.getRoom(roomId.value);
  if (!r) {
    // Room not found yet (syncing?)
    // Set up a one-time listener for when a room is added
    if (!store.client.listeners(ClientEvent.Room).includes(onRoomAdded)) {
        store.client.on(ClientEvent.Room, onRoomAdded);
    }
    room.value = null;
    return;
  }
  
  // Found room, clean up temp listener
  store.client.removeListener(ClientEvent.Room, onRoomAdded);
  room.value = r;
  myMembership.value = r.getMyMembership();

  // If invited, we don't need to load history or members
  if (myMembership.value === 'invite') {
    messages.value = [];
    isLoadingHistory.value = false;
    return;
  }

  // Hydrate members for lazy loading (non-blocking)
  r.loadMembersIfNeeded();

  // Clear decryption tracking for the new room
  decryptionListenerIds.clear();

  try {
    isLoadingHistory.value = true;
    
    // ONLY clear messages if we are switching to a new room. 
    // If it's a refresh of the same room, keep them visible to avoid scroll jumps.
    if (lastRoomId !== roomId.value) {
        messages.value = [];
        lastRoomId = roomId.value;
    }

    // Initialize TimelineWindow
    const timelineSet = r.getLiveTimeline().getTimelineSet();
    timelineWindow.value = new TimelineWindow(store.client as MatrixClient, timelineSet);

    // Load initial window (latest messages)
    await timelineWindow.value.load(undefined, 30);
    
    // PROACTIVE LOADING: If we have very few messages, try to fetch more history immediately.
    // We check the raw events in the window before rebuilding the UI messages.
    const events = timelineWindow.value.getEvents();
    if (events.length < 15 && timelineWindow.value.canPaginate(Direction.Backward)) {
        console.log(`[Chat] Event count low (${events.length}), proactively fetching history...`);
        await timelineWindow.value.paginate(Direction.Backward, 20);
    }

    // Now that everything is loaded (initial + proactive), update the UI once
    refreshMessagesFromWindow();

    // Populate gameStates cache from initial timeline events
    const gameStateEvents = timelineWindow.value.getEvents();
    for (const ev of gameStateEvents) {
      const isEncrypted = ev.getType() === 'm.room.encrypted';
      const content = isEncrypted ? ev.getClearContent() : ev.getContent();
      const type = isEncrypted ? content?.type : ev.getType();

      if (type === 'cc.jackg.ruby.game.state' && content?.game_id) {
        activityStore.updateGameState(content.game_id, content);
      }
    }

  } catch (e) {
    console.error("Failed to load timeline window", e);
    toast.error("Failed to load message history");
  } finally {
    isLoadingHistory.value = false;
  }
  
  // Mark last message as read on entry
  const timeline = r.getLiveTimeline();
  const events = timeline.getEvents();
  if (events.length > 0) {
    const lastEvent = events[events.length - 1];
    if (lastEvent) {
        sendReadReceipt(lastEvent);
    }
  }
}



function onRoomAdded(room: Room) {
    if (room.roomId === roomId.value) {
        initRoom();
    }
}

const handleViewSourceEvent = ((e: CustomEvent) => {
  handleViewSource(e.detail);
}) as any;

onMounted(() => {
  if (store.client && roomId.value) {
    initRoom();
    setupListener();
  }
  window.addEventListener('view-message-source', handleViewSourceEvent);
  checkAndApplyPendingShare();
});

// Watch for room changes to track last opened
watch(room, (newRoom) => {
  if (newRoom && store.client) {
    // Determine context based on route
    let context: 'dm' | 'rooms' | string | null = null;
    
    if (route.path.startsWith('/chat/dms')) {
      context = 'dm';
    } else if (route.path.startsWith('/chat/rooms')) {
      context = 'rooms';
    } else if (route.path.startsWith('/chat/spaces')) {
      // For spaces, context is the space ID (first segment of id catch-all)
      const params = route.params.id;
      if (Array.isArray(params) && params.length > 0) {
        context = params[0] as string;
      } else if (typeof params === 'string') {
        context = params;
      }
    }

    if (context && !newRoom.isSpaceRoom()) {
      matrixService.setLastVisitedRoom(context, newRoom.roomId);
    }
  }
});

// Re-init when room changes (sidebar navigation)
watch(roomId, () => {
  if (store.client) {
    initRoom();
    checkAndApplyPendingShare();
  }
});

watch(() => uiStore.pendingShare, (newShare) => {
  if (newShare && roomId.value) {
    checkAndApplyPendingShare();
  }
});

function setupListener() {
  store.client?.on(RoomEvent.Timeline, onTimelineEvent);
  store.client?.on(RoomEvent.Receipt, onReceiptEvent);
  store.client?.on(RoomEvent.MyMembership, onMyMembership);
  store.client?.on(RoomEvent.Redaction, onRedactionEvent);
  store.client?.on(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
}

function teardownListener() {
  store.client?.removeListener(RoomEvent.Timeline, onTimelineEvent);
  store.client?.removeListener(RoomEvent.Receipt, onReceiptEvent);
  store.client?.removeListener(RoomEvent.MyMembership, onMyMembership);
  store.client?.removeListener(RoomEvent.Redaction, onRedactionEvent);
  store.client?.removeListener(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
}

// Handle late client init (e.g. page refresh)
watch(
  () => store.client,
  (newClient) => {
    if (newClient) {
      initRoom();
      setupListener();
    }
  }
);

onUnmounted(() => {
  teardownListener();
  store.client?.removeListener(ClientEvent.Room, onRoomAdded);
  if (observer) observer.disconnect();
  window.removeEventListener('view-message-source', handleViewSourceEvent);
});

// --- Context Menu Actions ---

const replyingTo = computed({
  get: () => uiStore.composerStates[roomId.value ?? '']?.replyingTo || null,
  set: (val) => uiStore.setUIComposerState(roomId.value!, { replyingTo: val })
});

const editingMessage = computed({
  get: () => uiStore.composerStates[roomId.value ?? '']?.editingMessage || null,
  set: (val) => uiStore.setUIComposerState(roomId.value!, { editingMessage: val })
});

function cancelAction() {
  replyingTo.value = null;
  editingMessage.value = null;
  newMessage.value = '';
}

watch([editingMessage, replyingTo], ([newEdit, newReply], [oldEdit, oldReply]) => {
  if ((newEdit && !oldEdit) || (newReply && !oldReply)) {
    nextTick(() => {
        const el = textareaRef.value?.$el || textareaRef.value;
        const ta = el?.querySelector('textarea') || el;
        if (ta && ta.focus) {
          ta.focus();
          // Trigger height adjustment for the new content
          ta.style.height = 'auto';
          ta.style.height = `${ta.scrollHeight}px`;
        }
    });
  }
});



async function handleReaction(msg: ChatMessage, key: string) {
  if (!room.value || !store.client) return;
  try {
    // Cast event type to any or string to avoid strict enum check if 'm.reaction' isn't in it
    await store.client.sendEvent(room.value.roomId, 'm.reaction' as any, {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: msg.eventId,
        key: key
      }
    });
    toast.success('Reaction sent');
    
    // Close context menu and popovers by dispatching escape key
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  } catch (err) {
    console.error('Failed to send reaction', err);
    toast.error('Failed to react');
  }
}

function onEmojiSelect(emoji: any, msg: ChatMessage) {
    if (emoji && emoji.i) {
        handleReaction(msg, emoji.i);
        // Also close the picker locally
        if (msg.eventId) {
            showReactionPickerMap.value[msg.eventId] = false;
        }
    }
}

async function handleViewSource(msgEventId: string) {
  if (!room.value || !store.client) return;
  try {
      const event = await store.client.fetchRoomEvent(room.value.roomId, msgEventId);
      sourceEvent.value = event;
  } catch (e) {
      toast.error('Failed to fetch event source');
  }
}

async function toggleReaction(msg: ChatMessage, key: string, myReactionEventId?: string) {
    if (!room.value || !store.client) return;

    try {
        if (myReactionEventId) {
            // Remove reaction
            await store.client.redactEvent(room.value.roomId, myReactionEventId);
            // toast.success('Reaction removed'); // Optional feedback
        } else {
            // Add reaction
            await handleReaction(msg, key);
        }
    } catch (err) {
        console.error('Failed to toggle reaction', err);
        toast.error('Failed to update reaction');
    }
}

function formatReactors(senders: string[]): string {
    if (!senders || senders.length === 0) return 'Unknown';
    
    // Resolve sender names if possible
    const names = senders.map(id => {
        const member = room.value?.getMember(id);
        return member?.name || id;
    });

    if (names.length <= 3) {
        return names.join(', ');
    }
    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} others`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch (err) {
    console.error('Failed to copy to clipboard', err);
    toast.error('Failed to copy');
  }
}

async function redactEvent(eventId: string) {
  if (!room.value || !store.client) return;
  
  if (!confirm('Are you sure you want to delete this message?')) return;

  try {
    await store.client.redactEvent(room.value.roomId, eventId);
    toast.success('Message deleted');
  } catch (err) {
    console.error('Failed to delete message', err);
    toast.error('Failed to delete message');
  }
}
</script>

<style scoped>
/* Hide scrollbar but keep scroll functionality */
.overflow-y-auto {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--border)) transparent;
}
</style>