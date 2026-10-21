/**
 * The Tumult plugin API — vendored, self-contained, one file.
 *
 * A plugin author needs these types and nothing else. The file is GENERATED
 * from the Tumult repository: do not edit it by hand. Its source is
 * `packages/ui/src/plugins/authoring.ts` (the explicit plugin-author surface),
 * bundled by `packages/ui/scripts/build-plugin-types.ts` and guarded by
 * `packages/ui/test/plugin-types.test.ts`, which fails when this file and the
 * generator disagree. To pick up an API change, update authoring.ts and run
 * `pnpm --filter @tumult/ui emit:types`.
 *
 * The `vue` import here is a TYPE-only dependency; a plugin's template lists
 * `vue` for its types, while the runtime component comes from the shell
 * (`globalThis.__tumult.vue`). Pinned to plugin API `1.0.0` and core contract
 * `1.0.0` — the versions a manifest's `minUI` / `minCore` are compared
 * against.
 */

import { Component, InjectionKey, Ref } from 'vue';

/**
 * The contract between `@tumult/core` and everything above it.
 *
 * Nothing in this file may reference a matrix-js-sdk type. The UI is allowed to
 * know these shapes and nothing else; core is free to change how it produces
 * them. Every value here is a plain snapshot — safe to hold, compare and render
 * without worrying that the SDK mutated it underneath you.
 */
/**
 * Version of THIS contract — the shapes below. Bump on any change plugins or
 * the UI could depend on (a new field is a bump only if consumers must see it;
 * an added optional method is not). `minCore` in a plugin manifest is checked
 * against this at install (see `@tumult/ui`'s `checkManifestCompatibility`),
 * so it must stay a value module: nothing in it may import the SDK.
 */
export declare const CONTRACT_VERSION = "1.0.0";
/** Cancels a subscription created by {@link Subscribable.subscribe}. */
export interface Subscription {
	unsubscribe(): void;
}
/**
 * A current value plus a change feed.
 *
 * `get()` always returns the latest snapshot, so a subscriber never has to
 * handle "no value yet". Listeners fire after the snapshot has been replaced.
 */
export interface Subscribable<T> {
	get(): T;
	subscribe(listener: (value: T) => void): Subscription;
}
/**
 * Where the sync loop is, as far as the UI is concerned.
 *
 * This is deliberately coarser than the SDK's own sync states: PREPARED and
 * CATCHUP both land on `syncing` because the UI treats them identically.
 */
export type ConnectionState = "starting" | "syncing" | "reconnecting" | "error" | "stopped";
/** Local send lifecycle. `sending` is a local echo with no server event yet. */
export type MessageStatus = "sending" | "sent" | "failed";
/**
 * Whether we can read a message yet.
 *
 * `pending` is not an error: encrypted events routinely arrive before the keys
 * that open them, and upgrade to `ok` or `failed` later. The UI must render it
 * as a placeholder rather than dropping the event.
 */
export type DecryptionStatus = "ok" | "pending" | "failed";
export interface MessageView {
	id: string;
	/** Matrix event type, e.g. "m.room.message", "cc.jackg.tumult.chess.move". */
	type: string;
	senderId: string;
	/**
	 * Sender's display name as of this event (member state at the time),
	 * falling back to the user id. Never empty.
	 */
	senderName: string;
	/** Sender's avatar as an `mxc://` URI — resolve via `resolveMedia()`. */
	senderAvatarUrl: string | null;
	body: string;
	timestamp: number;
	status: MessageStatus;
	decryption: DecryptionStatus;
	/** Type-specific payload as plain JSON. The registered renderer owns its shape. */
	content: Readonly<Record<string, unknown>>;
	/** True when an `m.replace` edit superseded this message's body. */
	edited: boolean;
	/**
	 * True once a redaction tombstoned this message: the body reads
	 * "Message deleted." and edit/delete affordances must hide.
	 */
	redacted: boolean;
	/**
	 * A compact quote of the message this one replies to (`m.in_reply_to`),
	 * or `null` when it isn't a reply.
	 *
	 * The quoted sender/body come from the replied-to event when it is in the
	 * loaded window (post-edit, redaction-aware) and from parsing the reply's
	 * own fallback text otherwise, so a quote renders before the history
	 * around it has been paginated in. `body` never contains the `> ` prefix.
	 */
	reply: ReplyView | null;
	/** Aggregated `m.reaction` annotations on this message. Never null. */
	reactions: ReactionView[];
	/**
	 * Users who have read at least this far, for whom this is the deepest
	 * held message — i.e. each reader appears on exactly one row, the
	 * Discord-style "seen" marker. Includes ourselves once our receipt
	 * lands. Never null.
	 */
	readBy: string[];
}
/** One quoted target of an inline reply. */
export interface ReplyView {
	/** Event id of the replied-to message. */
	eventId: string;
	/** Sender of the quoted message; `""` when neither event nor fallback knows it. */
	senderId: string;
	/** Quoted sender's display name; falls back to `senderId`, `""` when unknown. */
	senderName: string;
	/** Quoted text with any `> ` reply fallback stripped; `""` when unknown. */
	body: string;
}
/** One grouped emoji annotation: count across senders, flag for our own. */
export interface ReactionView {
	emoji: string;
	count: number;
	ownReacted: boolean;
}
/**
 * One page of server-side room search results.
 *
 * Hits are ordinary `MessageView`s: same shapes, same `resolveMedia`, same
 * renderer registry. Encrypted hits carry `decryption: "pending"` — the
 * server can't search ciphertext, so an encrypted room simply matches
 * nothing (client-side search over decrypted history is a v1 non-goal).
 */
export interface SearchPage {
	/** Matches for this page, most recent first (server ordering). */
	hits: MessageView[];
	/** Opaque cursor for the next page; `null` when this is the last one. */
	nextBatch: string | null;
	/** Total matches the server knows about across all pages. */
	total: number;
}
/** Parameters for creating a top-level space (a guild on the rail). */
export interface CreateSpaceParams {
	name: string;
	topic?: string;
}
/**
 * Parameters for creating a channel inside a space.
 *
 * `visibility` defaults to private. `aliasLocalpart` only applies to public
 * rooms — it is the localpart of `#alias:server`, which is what `joinRoom`
 * later resolves. `encrypted` defaults to false; spaces never encrypt (they
 * don't host messages).
 */
export interface CreateChannelParams {
	name: string;
	topic?: string;
	visibility?: "private" | "public";
	aliasLocalpart?: string;
	encrypted?: boolean;
}
/** Parameters for creating a 1:1 direct-message room. */
export interface CreateDmParams {
	userId: string;
	encrypted?: boolean;
}
/** One user-directory hit, as the DM/invite pickers need it. */
export interface UserSearchResult {
	userId: string;
	displayName: string;
	/** Usually an `mxc://` URI — pass through `resolveMedia()`. */
	avatarUrl: string | null;
}
/** Who may join the room. The server default is `"invite"`. */
export type JoinRule = "public" | "invite" | "knock" | "restricted";
/**
 * How much conversation history new members can see. The server default is
 * `"shared"`; `"world_readable"` additionally exposes history — not the
 * timeline — to unauthenticated visitors.
 */
export type HistoryVisibility = "shared" | "invited" | "joined" | "world_readable";
/**
 * Editable room settings. Every field is optional; omitted fields are left
 * unchanged. `null` clears the field (`topic`, `avatar`, `canonicalAlias`),
 * while `undefined` means "not touched".
 */
export interface RoomSettingsPatch {
	/** Trimmed before sending; empty clears the name (the fallback name returns). */
	name?: string;
	/** `null`, or empty after trimming, clears the topic. */
	topic?: string | null;
	/** Uploaded to the homeserver first; `null` clears the avatar. */
	avatar?: Blob | null;
	joinRule?: JoinRule;
	historyVisibility?: HistoryVisibility;
	/** Full `#alias:server` form; `null` (or empty after trim) removes it. */
	canonicalAlias?: string | null;
}
export interface RoomSummary {
	id: string;
	name: string;
	topic: string | null;
	/**
	 * Usually an `mxc://` URI — NOT directly loadable: pass it through
	 * `resolveMedia()`. May also be an already-loadable URL (fixtures).
	 */
	avatarUrl: string | null;
	/** True for Matrix spaces, which render as guilds/categories rather than channels. */
	isSpace: boolean;
	/** Parent spaces, used to build the guild rail. Empty means orphaned — a DM by our rule. */
	parentSpaceIds: string[];
	unreadCount: number;
	highlightCount: number;
	/**
	 * The `m.fully_read` marker for this room — the event before which the
	 * user has read everything — or `null` when never set. Drives the
	 * "New messages" divider in the timeline. Comes from room account data,
	 * so it changes on sync, not on our own sends.
	 */
	fullyReadEventId: string | null;
	/** Who can join: `"public"` | `"invite"` | `"knock"` | `"restricted"`. */
	joinRule: JoinRule;
	/** How much history new members see. Default `"shared"`. */
	historyVisibility: HistoryVisibility;
	/** The room's canonical alias (`#name:server`), or `null`. */
	canonicalAlias: string | null;
	/**
	 * True when the room carries the user's `m.favourite` room tag — the tag
	 * that feeds the global Favourites band in the rail (see
	 * `selectSpaceTree`'s `favourites`). Read from room account data (`m.tag`),
	 * so it follows sync, not the user's own sends. The write path is out of
	 * slice-27's scope.
	 */
	favourite: boolean;
	/**
	 * The `m.favourite` tag's `order` for this room, or `null` when the room
	 * is not favourited (or carried the tag without an order). Drives the order
	 * of favourites in the rail band: higher values sort first, `null` sorts
	 * last. Read from room account data (`m.favourite.order`), so it follows
	 * sync.
	 */
	favouriteOrder: number | null;
}
/** The signed-in identity. `null` when logged out. */
export interface SessionView {
	userId: string;
	/**
	 * Stable per-install device ID. Crypto identity is tied to it, so it is
	 * generated once and reused for the life of the session.
	 */
	deviceId: string;
	homeserverUrl: string;
}
/**
 * Encryption health of this device, as the UI needs it.
 *
 * `backupEnabled` means a key backup exists on the server and the engine is
 * running; `backupTrusted` means this device holds the backup decryption key.
 * A fresh device typically reads `{ enabled: true, trusted: false }` — the
 * recovery-key prompt state.
 */
export interface SecurityStatus {
	crossSigningReady: boolean;
	backupEnabled: boolean;
	backupTrusted: boolean;
	secretStorageReady: boolean;
}
interface VerificationRequestView {
	id: string;
	initiatedByMe: boolean;
	otherUserId: string;
	otherDeviceId: string | undefined;
	isSelfVerification: boolean;
	phase: "unsent" | "requested" | "ready" | "started" | "cancelled" | "done";
	sasEmoji: [
		string,
		string
	][] | null;
	sasDecimal: [
		number,
		number,
		number
	] | null;
}
interface VerificationState {
	requests: VerificationRequestView[];
}
interface TypingState {
	/** roomId → typing user ids (self excluded). */
	rooms: Record<string, string[]>;
}
/** Browser notification permission state. */
type NotificationPermission$1 = "default" | "denied" | "granted";
interface NotificationState {
	permission: NotificationPermission$1;
	supported: boolean;
}
/** One thread in a room, as the UI needs it. */
export interface ThreadSummary {
	rootEventId: string;
	replyCount: number;
	lastReplyTs: number;
	unreadCount: number;
	hasParticipated: boolean;
}
/** One of this account's devices, as the account menu needs it. */
export interface DeviceView {
	id: string;
	displayName: string | null;
	lastSeenTs: number | null;
	isCurrent: boolean;
	verified: boolean;
}
/**
 * Membership of a room, as the members pane shows it. The roster `members()`
 * publishes only `join` and `invite`; banned members arrive through the
 * separate `banned()` feed with `ban`. `leave`/`knock` are never published —
 * a departed user is simply absent.
 */
export type Membership = "join" | "invite" | "leave" | "ban" | "knock";
/**
 * Presence of a room member.
 *
 * `"unknown"` is a real state, not a placeholder: presence only exists once the
 * server has sent that user's `m.presence` *this session*. Presence restored
 * from the store's cache is deliberately not trusted (it can be days old and
 * still say `"online"`), so a member stays `"unknown"` until the server tells
 * us otherwise. Never invent `"online"`.
 */
export type PresenceState = "online" | "offline" | "unknown";
/** One member of a room, as the members pane needs it. */
export interface MemberView {
	userId: string;
	/** Plain display name (never disambiguated); the localpart when unnamed. */
	displayName: string;
	/** Usually an `mxc://` URI — pass through `resolveMedia()`. */
	avatarUrl: string | null;
	/** `join` or `invite` in the roster; `ban` in the banned feed. */
	membership: Membership;
	/** From the room's power levels — drives admin/mod grouping and ordering. */
	powerLevel: number;
	isSelf: boolean;
	presence: PresenceState;
	/**
	 * Approximate last-activity time (ms since epoch) derived from live
	 * presence, `null` when presence is unknown. A moment ago for `online`.
	 */
	lastActiveTs: number | null;
}
/** Our own profile, as the account menu and edit dialog need it. */
export interface ProfileView {
	userId: string;
	/** Plain display name; the localpart while unnamed. */
	displayName: string;
	/** Usually an `mxc://` URI — pass through `resolveMedia()`. */
	avatarUrl: string | null;
}
/**
 * A room's `m.room.power_levels`, as the moderation UI needs it: the parsed
 * thresholds plus this account's own standing. The `can*` flags are only the
 * *threshold* half of permission (whether `myPowerLevel` reaches the bar);
 * whether an action is allowed against a *specific* member also depends on
 * that member's level, which the UI compares row by row.
 *
 * Spec defaults fill any field the room has not overridden, so a room with no
 * power-levels event still yields a complete view.
 */
export interface RoomPowerLevelsView {
	/** Explicit per-user overrides (`users`). */
	users: Record<string, number>;
	usersDefault: number;
	eventsDefault: number;
	stateDefault: number;
	ban: number;
	kick: number;
	redact: number;
	invite: number;
	/** Per-event-type overrides (`events`), e.g. `{ "m.room.name": 100 }`. */
	events: Record<string, number>;
	/** This account's effective room level. */
	myPowerLevel: number;
	/** Whether `myPowerLevel` clears the room's kick / ban / state bar. */
	canKick: boolean;
	canBan: boolean;
	canSetPowerLevel: boolean;
	/**
	 * Whether this account may send the room's state events (name, topic,
	 * avatar, join rules, canonical alias…). Same `state_default` bar as
	 * `canSetPowerLevel`, kept separate because it gates different UI.
	 */
	canEditSettings: boolean;
}
export interface LoginParams {
	/** Base URL of the homeserver, e.g. `https://matrix.example.com`. */
	homeserverUrl: string;
}
export interface CompleteLoginParams {
	/**
	 * The full callback URL the IdP redirected back to, including its fragment.
	 * Secrets come back in the fragment by default, so pass the whole URL rather
	 * than pre-parsed query params.
	 */
	callbackUrl: string;
}
/**
 * The `file` descriptor on an encrypted `m.room.message` media event.
 * Plain JSON — no SDK types.
 */
export interface EncryptedAttachment {
	/** `mxc://` URI of the ciphertext. */
	url: string;
	/** JWK for the AES-CTR key. */
	key: {
		alg: string;
		key_ops: string[];
		kty: string;
		k: string;
		ext: boolean;
	};
	/** Base64 (unpadded) 16-byte initial counter block. */
	iv: string;
	/** Ciphertext hashes, keyed by algorithm name (`sha256`). */
	hashes: Record<string, string>;
	/** Version string (currently `"v2"`). */
	v: string;
}
export interface ChatClient {
	/**
	 * Begin MAS login.
	 *
	 * This navigates the browser to the identity provider, so in a browser the
	 * returned promise never resolves — the page is gone. It rejects if
	 * discovery or client registration fails before the redirect.
	 */
	login(params: LoginParams): Promise<void>;
	/**
	 * Finish login after the IdP redirects back. Exchanges the authorization
	 * code for tokens and persists the session.
	 */
	completeLogin(params: CompleteLoginParams): Promise<void>;
	/**
	 * Rehydrate a persisted session without user interaction.
	 * Resolves `false` when there is nothing stored to restore.
	 */
	restoreSession(): Promise<boolean>;
	/** Revoke tokens, drop the crypto store, and clear persisted session state. */
	logout(): Promise<void>;
	/** Boot crypto and start the sync loop. Requires a session. */
	start(): Promise<void>;
	/** Stop the sync loop without discarding the session. */
	stop(): Promise<void>;
	session: Subscribable<SessionView | null>;
	connection: Subscribable<ConnectionState>;
	rooms: Subscribable<RoomSummary[]>;
	security: Subscribable<SecurityStatus>;
	verification: Subscribable<VerificationState>;
	typing: Subscribable<TypingState>;
	notifications: Subscribable<NotificationState>;
	/**
	 * Our own profile, published once `start()` boots and after every
	 * successful `setProfile()`. `null` before there is a session.
	 */
	profile: Subscribable<ProfileView | null>;
	/**
	 * Snapshot feed for one room's timeline.
	 *
	 * Must return the same `Subscribable` instance for a given `roomId` on
	 * every call, so two panes on one room share one snapshot and
	 * `Observable.subscriberCount` can drive idle-room unloading later.
	 */
	timeline(roomId: string): Subscribable<MessageView[]>;
	/**
	 * Paginate one page of history backwards into `timeline(roomId)`.
	 *
	 * Resolves `true` when the page added events (more may exist), `false`
	 * when the start of history — or a gap the client won't fill — is
	 * reached. Concurrent calls for one room collapse into a single request.
	 */
	loadMore(roomId: string): Promise<boolean>;
	/**
	 * Send one plaintext message. `replyToEventId`, when given, makes it a
	 * rich reply: `m.relates_to.m.in_reply_to` on the wire plus a `> `-quoted
	 * fallback body for clients that don't understand relations.
	 */
	send(roomId: string, body: string, replyToEventId?: string): Promise<void>;
	/**
	 * Retry a failed send — the pending event the SDK left in `NOT_SENT`.
	 * Resolves once the re-sent request settles; the map still surfaces a
	 * subsequent failure through the `failed` status.
	 */
	retry(roomId: string, eventId: string): Promise<void>;
	/**
	 * Upload and send a media file (image, video, audio, or generic file).
	 *
	 * The file is uploaded to the homeserver first, then an `m.room.message`
	 * is sent with the resulting `mxc://` URI. The SDK owns the local echo
	 * lifecycle; the feed maps every transition. `body` is an optional caption
	 * — when omitted, the filename is used.
	 */
	sendMediaMessage(roomId: string, file: File | Blob, body?: string): Promise<void>;
	/**
	 * Toggle our `emoji` reaction on a message: sends `m.reaction` when we
	 * haven't reacted, redacts our reaction when we have. The feed maps the
	 * result; the returned promise only signals the request finished.
	 */
	toggleReaction(roomId: string, targetEventId: string, emoji: string): Promise<void>;
	/**
	 * Replace our message's body via `m.replace`. Only our own messages can
	 * be edited; the feed applies the latest edit from the sender.
	 */
	edit(roomId: string, targetEventId: string, newBody: string): Promise<void>;
	/**
	 * Send or clear our typing notification. `isTyping: false` clears it.
	 * The server auto-expires after ~20s; callers should re-send or clear
	 * on blur/send.
	 */
	sendTyping(roomId: string, isTyping: boolean): Promise<void>;
	/**
	 * False when the homeserver has no thread support (pre-v1.4). The UI hides
	 * thread affordances rather than offering a feature that silently degrades.
	 * Also false before `start()`, while capability is still unknown.
	 */
	supportsThreads(): boolean;
	/**
	 * Resolve an `mxc://` URI to a URL an `<img>` can load, at `size` CSS px
	 * (fetched at 2x). Authenticated media needs the access token, so this is
	 * typically a `blob:` URL. Non-mxc URLs resolve to themselves. Rejects on
	 * failure — render a fallback. Shared per image; cheap to call per render.
	 */
	resolveMedia(uri: string, size: number): Promise<string>;
	/**
	 * Resolve an `mxc://` URI to the full (unresized) media as a URL a
	 * `<video>`/`<audio>`/download link can use — the whole file, not a
	 * thumbnail. Needed for `m.video`/`m.audio`/`m.file`: the thumbnail
	 * endpoint is an image pipeline and rejects formats it cannot render
	 * (`400`, which used to surface as a console error on every rebuild), so
	 * non-image attachments download instead. Typically a `blob:` URL.
	 * Non-mxc URLs resolve to themselves. Rejects on failure.
	 */
	resolveMediaDownload(uri: string): Promise<string>;
	/**
	 * Resolve an encrypted attachment (the `file` descriptor on an encrypted
	 * `m.room.message`) to a URL an `<img>` can load — fetches the ciphertext
	 * and decrypts it. Typically a `blob:` URL. Rejects on failure.
	 */
	resolveEncryptedMedia(file: EncryptedAttachment): Promise<string>;
	/**
	 * Request browser notification permission from the user.
	 *
	 * Resolves to the resulting permission (`"granted"`, `"denied"`, or
	 * `"default"` if the prompt was dismissed). No-op returning `"denied"`
	 * when the Notification API is unsupported.
	 */
	requestNotificationPermission(): Promise<NotificationPermission$1>;
	/**
	 * Thread list for a room. Same `Subscribable` per roomId on repeat calls.
	 */
	threads(roomId: string): Subscribable<ThreadSummary[]>;
	/**
	 * Timeline for one thread. Same `Subscribable` per threadId on repeat calls.
	 */
	threadTimeline(threadId: string): Subscribable<MessageView[]>;
	/** Send a reply into a thread (the SDK adds the thread relation). */
	sendReply(roomId: string, threadId: string, body: string): Promise<void>;
	/** Mark a thread as read up to its latest event. */
	markThreadRead(threadId: string): Promise<void>;
	/**
	 * Send a read receipt for the latest held event in a room, and set the
	 * `m.fully_read` marker to the same point. Called when the user is
	 * viewing the live tail; throttled per room so re-renders don't spam the
	 * server. This is what clears our unread badge AND positions the
	 * "New messages" divider.
	 */
	markRead(roomId: string): Promise<void>;
	/**
	 * Redact (delete) an event: our own messages, or anything our power
	 * levels allow. The target tombstones ("Message deleted.") when the
	 * redaction lands on the next sync — the redaction event itself never
	 * renders. Rejects when the server refuses; the row keeps its content.
	 */
	redact(roomId: string, eventId: string, reason?: string): Promise<void>;
	/**
	 * Server-side search over one room's history, most recent match first.
	 *
	 * `opts.nextBatch` (from a previous page's `nextBatch`) fetches the
	 * following page. Encrypted events are invisible to the server, so
	 * encrypted rooms effectively return no hits — honest, not an error.
	 * Rejects when the homeserver has search disabled.
	 */
	search(roomId: string, term: string, opts?: {
		nextBatch?: string;
	}): Promise<SearchPage>;
	/**
	 * Make sure `eventId` is in `timeline(roomId)` by paginating history
	 * backwards, bounded (the UI jumps to it afterwards). Resolves `false`
	 * when the event is older than the bound or gone (redacted-and-purged,
	 * never-joined history) — callers must not scroll on `false`.
	 */
	jumpTo(roomId: string, eventId: string): Promise<boolean>;
	/**
	 * Tell the client which room the user is viewing. Under sliding sync the
	 * room is kept subscribed with a richer timeline window (and its members
	 * are polled first for presence), so it stays live even when it sits
	 * outside the room-list range. No-op under classic `/sync`.
	 */
	setRoomSelection(roomId: string | null): void;
	/**
	 * Grow the sliding-sync room window by one page and resend. Resolves
	 * `false` at the window cap, before the window is applied, or under
	 * classic `/sync` — callers must not offer more on `false`.
	 */
	loadMoreRooms(): Promise<boolean>;
	/**
	 * Whether the sliding-sync window still has rooms behind it, i.e. a
	 * "load more" affordance should be shown. False once the window covers
	 * every joined room, at the window cap, or under classic `/sync` and the
	 * fake (which hold the full room list up front).
	 */
	hasMoreRooms(): boolean;
	/**
	 * Create a top-level space (renders as a guild on the rail). Resolves to
	 * the new room id once the server has it; it lands in `rooms` on a later
	 * sync — the UI waits for the feed before selecting it.
	 */
	createSpace(params: CreateSpaceParams): Promise<string>;
	/**
	 * Create a channel under `spaceId` and link it (`m.space.child` on the
	 * space, `m.space.parent` on the channel). Public channels take an
	 * `aliasLocalpart` so others can `joinRoom("#alias:server")`. Resolves to
	 * the new room id; it lands in `rooms` on a later sync.
	 */
	createChannel(spaceId: string, params: CreateChannelParams): Promise<string>;
	/**
	 * Create a private 1:1 room with `userId`, inviting them and recording it
	 * in `m.direct`. Resolves to the new room id; lands in `rooms` on a later
	 * sync (as an orphan, i.e. in the DMs tab).
	 */
	createDm(params: CreateDmParams): Promise<string>;
	/**
	 * Join a room by id or `#alias:server`. Also accepts an invite to a room
	 * we're not in yet. Resolves to the room id; it lands in `rooms` on a
	 * later sync.
	 */
	joinRoom(idOrAlias: string): Promise<string>;
	/**
	 * Leave a room we're in (or reject an invite). The room leaves `rooms` on
	 * a later sync; the UI must clear a selection that points at it.
	 */
	leave(roomId: string): Promise<void>;
	/** Invite `userId` to `roomId`. Rejects when the server refuses. */
	invite(roomId: string, userId: string): Promise<void>;
	/**
	 * Update a room's settings. Only the fields present in `patch` are sent,
	 * each independently (the apply-what-works rule from `writeProfile`) — a
	 * later failure leaves earlier fields applied and surfaces through the
	 * returned rejection. The `rooms` feed catches up on the next sync.
	 * Permission failures are the server's to reject.
	 */
	updateRoomSettings(roomId: string, patch: RoomSettingsPatch): Promise<void>;
	/**
	 * User-directory search over ids, display names and domains. Accepts a
	 * raw `@user:server` id too (the UI shows both kinds of input), but the
	 * directory itself only matches what the server indexes.
	 */
	searchUsers(term: string, opts?: {
		limit?: number;
	}): Promise<UserSearchResult[]>;
	/**
	 * Member roster for one room. Same `Subscribable` per roomId on repeat
	 * calls (same rule as `timeline`). Ordered by power level descending,
	 * then display name; only `join` and `invite` members appear.
	 *
	 * Under lazy loading the first snapshot can be partial — it holds whoever
	 * came through sync until `loadMembers(roomId)` resolves.
	 */
	members(roomId: string): Subscribable<MemberView[]>;
	/**
	 * Fetch a room's full membership list the first time its members pane
	 * opens. Resolves once `members(roomId)` holds the complete roster.
	 * Rejects when the homeserver refuses — the feed keeps whatever it
	 * already had, so the UI must surface the failure rather than present a
	 * partial roster as complete. Concurrent calls for one room collapse.
	 */
	loadMembers(roomId: string): Promise<void>;
	/**
	 * A room's power levels plus this account's standing in it. Same
	 * `Subscribable` per roomId on repeat calls (same rule as `timeline`).
	 * `null` while the room is unknown (left/kicked) — there is no honest
	 * view of another room's thresholds.
	 */
	powerLevels(roomId: string): Subscribable<RoomPowerLevelsView | null>;
	/**
	 * Members banned from a room (`membership === "ban"`). Same `Subscribable`
	 * per roomId. Banned users are absent from `members()` — the roster is
	 * join/invite only — so this is the only surface that lists them.
	 */
	banned(roomId: string): Subscribable<MemberView[]>;
	/** Kick `userId` from `roomId`, with an optional reason. Server-enforced. */
	kick(roomId: string, userId: string, reason?: string): Promise<void>;
	/** Ban `userId` from `roomId`, with an optional reason. Server-enforced. */
	ban(roomId: string, userId: string, reason?: string): Promise<void>;
	/**
	 * Lift a ban. The user's membership returns to `leave` — they drop off
	 * `banned()` but do not reappear in the roster until they re-join.
	 */
	unban(roomId: string, userId: string): Promise<void>;
	/** Set a member's explicit power level (0–100 in the UI). Server-enforced. */
	setPowerLevel(roomId: string, userId: string, powerLevel: number): Promise<void>;
	/**
	 * Update our own profile: a `displayName` through the profile endpoint
	 * (empty string clears it), and/or an `avatar` uploaded to the media
	 * repository (`null` clears the avatar). Then re-reads the profile so the
	 * `profile` feed reflects what the server stored. Rejects on failure and
	 * refreshes the feed from the server, so a half-applied change (name
	 * landed, upload failed) is shown honestly.
	 */
	setProfile(params: {
		displayName?: string;
		avatar?: Blob | null;
	}): Promise<void>;
	/**
	 * Set up secret storage plus a fresh key backup, returning the encoded
	 * recovery key. Display it to the user exactly once — it is never
	 * retrievable again.
	 */
	setupRecovery(): Promise<string>;
	/**
	 * Restore the key backup from a recovery key the user pastes in, then
	 * decrypt what it unlocks. Rejects when the key is malformed or does
	 * not match this account's backup; changes nothing on failure.
	 * Resolves `true` when the device also became verified.
	 */
	restoreBackup(recoveryKey: string): Promise<boolean>;
	/**
	 * Start an interactive SAS verification of this user (own devices).
	 * Resolves when the request has been sent; the UI tracks progress
	 * through the `verification` feed.
	 */
	startVerification(): Promise<void>;
	/** Accept an incoming verification request. */
	acceptVerification(id: string): Promise<void>;
	/** Decline an incoming verification request. */
	declineVerification(id: string): Promise<void>;
	/** Confirm the SAS emoji/decimal match. */
	confirmSas(id: string): Promise<void>;
	/** Report the SAS does not match (cancels with m.mismatched_sas). */
	mismatchSas(id: string): Promise<void>;
	/** This account's devices with verification status, current device first. */
	listDevices(): Promise<DeviceView[]>;
}
export interface TimelineRendererProps {
	message: MessageView;
}
export interface RendererEntry {
	component: Component;
	/** Higher wins. Entries without `match` sort last within their bucket. */
	priority: number;
	match?: (message: MessageView) => boolean;
}
/**
 * Owned per-shell via provide/inject — never a module singleton, so two
 * shells on one page cannot share mutable registration state.
 */
export declare class TimelineRegistry {
	private readonly buckets;
	/**
	 * Bumped on every `register()`. The `buckets` map itself is a plain Map, not
	 * `reactive()`, so Vue has no way to see a mutation inside it — a renderer
	 * registered after a message has already rendered (the common case: a plugin
	 * registers from `onMounted`, by which time fixture/cached messages have
	 * already painted) would otherwise never take effect, because the consuming
	 * `computed` has nothing reactive to re-run on. Reading `.value` inside
	 * `resolve()`'s caller creates that dependency — the same snapshot-plus-
	 * version-counter shape used for SDK-mutated objects elsewhere in this repo.
	 */
	readonly version: Ref<number>;
	register(type: string, entry: RendererEntry): void;
	/**
	 * Remove exactly this entry (by identity) — the other half of `register`,
	 * so plugin disposables can take a registration back. A no-op when the
	 * entry is already gone (a disposable run twice must stay harmless).
	 * Bumps `version` like `register`, so resolution re-runs.
	 */
	unregister(type: string, entry: RendererEntry): void;
	resolve(message: MessageView, fallback: Component): Component;
}
export declare const RegistryKey: InjectionKey<TimelineRegistry>;
export declare function useTimelineRegistry(): TimelineRegistry;
/**
 * What an action sees when it runs — and the only way it touches the draft.
 * Building the context requires a room and a client, so an action cannot run
 * outside them.
 */
export interface ComposerActionContext {
	/** The room the composer is writing into. */
	roomId: string;
	/** The draft exactly as typed when the action ran. */
	draft: string;
	/** The chat client (send, react, …) — the same contract the UI uses. */
	client: ChatClient;
	/** Replace the draft without sending (e.g. insert text for review). */
	setDraft(text: string): void;
}
/**
 * One button in the composer's action row (next to the attach button). Buttons
 * are icon-first, so `label` is required — it is the accessible name and the
 * tooltip.
 */
export interface ComposerAction {
	/** Stable, namespaced id — the registry keys by it. */
	id: string;
	/** Accessible name; also the tooltip. */
	label: string;
	/** Glyph rendered in the button; falls back to the label text. */
	icon?: string;
	/** Higher sorts further left. Default 0. */
	priority?: number;
	run(ctx: ComposerActionContext): void | Promise<void>;
}
/**
 * Per-shell composer-action registry (provide/inject — never a module
 * singleton, same rule as `TimelineRegistry`).
 */
export declare class ComposerActionsRegistry {
	private readonly list;
	add(action: ComposerAction): Disposable$1;
	remove(id: string): boolean;
	/** Highest priority first. */
	all(): ComposerAction[];
}
export declare const ComposerActionsKey: InjectionKey<ComposerActionsRegistry>;
/**
 * `null` outside a shell: `MessageComposer` is an exported primitive, and a
 * standalone use renders no plugin affordances rather than throwing.
 */
export declare function useComposerActions(): ComposerActionsRegistry | null;
/** What a command sees when it runs. */
export interface CommandContext {
	/** The room the command was typed into. */
	roomId: string;
	/** The chat client (send, react, …) — the same contract the UI uses. */
	client: ChatClient;
	/** Everything after `/name`, trimmed ("" when the command had no args). */
	args: string;
	/** The full typed line, e.g. `/shrug deal with it`. */
	raw: string;
}
/**
 * A slash command. Typing `/name args` and submitting runs it instead of
 * sending the text; the composer's suggestion list is built from `name`,
 * `description` and `usage`.
 */
export interface Command {
	/** Lowercase name without the slash — a leading "/" and case are normalized. */
	name: string;
	/** Palette line under the name. */
	description?: string;
	/** Palette hint next to the name, e.g. `<text>`. */
	usage?: string;
	run(ctx: CommandContext): void | Promise<void>;
}
/** A command match — `resolve()` keeps the parsed args with the command. */
export interface ResolvedCommand {
	command: Command;
	args: string;
	raw: string;
}
/**
 * Per-shell slash-command registry (provide/inject — never a module
 * singleton).
 */
export declare class CommandsRegistry {
	private readonly list;
	/** Add a command. A leading "/" and casing are normalized; bad names throw. */
	add(command: Command): Disposable$1;
	remove(name: string): boolean;
	/** Commands whose name starts with `prefix` ("" → all), alphabetical. */
	suggest(prefix: string): Command[];
	/**
	 * Parse `/name args` — an exact name match at the start of `input`.
	 * Returns `null` for anything else (plain text, an unknown command, or a
	 * longer word that merely starts the same), so the composer sends those
	 * verbatim instead of guessing.
	 */
	resolve(input: string): ResolvedCommand | null;
	/** Alphabetical snapshot. */
	all(): Command[];
}
export declare const CommandsKey: InjectionKey<CommandsRegistry>;
/**
 * `null` outside a shell: `MessageComposer` is an exported primitive, and a
 * standalone use simply has no commands to run.
 */
export declare function useCommands(): CommandsRegistry | null;
/** Props every decoration component receives. */
export interface MemberDecorationProps {
	member: MemberView;
	/** The room the member row belongs to. */
	roomId: string;
}
/**
 * A small component rendered after a member row's built-in badges (Invited /
 * Banned) — role icons, bot flags, anything a plugin wants to mark a member
 * with. `match` is the only way to filter, and it runs on every roster
 * rebuild; keep it cheap.
 */
export interface MemberDecoration {
	/** Stable, namespaced id — the registry keys by it. */
	id: string;
	component: Component;
	/** Higher sorts further right. Default 0. */
	priority?: number;
	/** Render only for members this returns true for. Default: every member. */
	match?(member: MemberView): boolean;
}
/**
 * Per-shell member-decoration registry (provide/inject — never a module
 * singleton).
 */
export declare class MemberDecorationsRegistry {
	private readonly list;
	add(decoration: MemberDecoration): Disposable$1;
	remove(id: string): boolean;
	/** Decorations that apply to `member`, highest priority first. */
	resolve(member: MemberView): MemberDecoration[];
}
export declare const MemberDecorationsKey: InjectionKey<MemberDecorationsRegistry>;
export declare function useMemberDecorations(): MemberDecorationsRegistry;
/** Props every settings tab receives. */
export interface SettingsTabProps {
	/** The chat client — the same contract the UI itself uses. */
	client: ChatClient;
	/** Close the settings dialog (e.g. from a finished action). */
	close(): void;
}
/**
 * One tab in the settings dialog. The shell contributes its own tabs (the
 * plugin list) and plugins add theirs; everything else is a normal Vue
 * component, so a tab can `inject()` anything the shell provides (media
 * resolvers, the plugin registry) on top of its props.
 */
export interface SettingsTab {
	/** Stable, namespaced id — the registry keys by it. */
	id: string;
	/** Label in the tab strip. */
	title: string;
	component: Component;
	/** Higher sorts earlier (built-in tabs at 0, plugins default after). */
	priority?: number;
}
/**
 * Per-shell settings-tab registry (provide/inject — never a module singleton,
 * same rule as `TimelineRegistry`).
 */
export declare class SettingsTabsRegistry {
	private readonly list;
	add(tab: SettingsTab): Disposable$1;
	remove(id: string): boolean;
	/** Highest priority first. */
	all(): SettingsTab[];
}
export declare const SettingsTabsKey: InjectionKey<SettingsTabsRegistry>;
export declare function useSettingsTabs(): SettingsTabsRegistry;
/**
 * One workspace pane — a top-level region of the shell that a plugin fills.
 *
 * A pane is what the guild rail's *other* kind of tile opens: the DMs button
 * and the guild tiles open rooms, a pane tile opens the plugin's own region.
 * The shell keeps its layout (the rail, the tracks, the chrome) and hands the
 * pane three slots to fill; the plugin never replaces a region, it occupies
 * the one it was given.
 */
export interface WorkspacePane {
	/** Stable, namespaced id — the registry keys by it, and the route uses it. */
	id: string;
	/** Label in the rail tile's tooltip and its accessible name. */
	label: string;
	/** Glyph rendered in the rail tile. Defaults to the label's first letter. */
	icon?: string;
	/** Higher sorts nearer the top of the rail. Default 0. */
	priority?: number;
	/** The main area — the track the timeline normally occupies. */
	content: Component;
	/** The left nav — the track the channel list normally occupies. */
	sidebar?: Component;
	/** The bottom bar, spanning the pane's width — the player. */
	footer?: Component;
}
/**
 * Per-shell workspace-pane registry (provide/inject — never a module
 * singleton, same rule as `SettingsTabsRegistry`).
 */
export declare class WorkspacePanesRegistry {
	private readonly list;
	add(pane: WorkspacePane): Disposable$1;
	remove(id: string): boolean;
	/** The pane registered under `id`, or undefined. */
	get(id: string): WorkspacePane | undefined;
	/** Highest priority first. */
	all(): WorkspacePane[];
}
export declare const WorkspacePanesKey: InjectionKey<WorkspacePanesRegistry>;
export declare function useWorkspacePanes(): WorkspacePanesRegistry;
export interface RoomSelection {
	view: "dms" | "guild" | "pane";
	guildId?: string | undefined;
	roomId?: string | undefined;
	/** The workspace pane's id — set only when `view` is `"pane"`. */
	paneId?: string | undefined;
}
export interface SelectionContext {
	current: RoomSelection;
	select(next: RoomSelection): void;
	hrefFor(next: RoomSelection): string;
}
export declare const SelectionKey: InjectionKey<SelectionContext>;
export declare function useSelection(): SelectionContext;
/** The thing a leave is about: room id plus enough display state to say so. */
export interface LeaveTarget {
	id: string;
	name: string;
	isSpace: boolean;
}
/** What a member row can ask the shell to do. */
export type MemberModerationKind = "kick" | "ban" | "unban" | "set-power";
/** A moderation request from a member row, scoped to the room it came from. */
export interface MemberModeration {
	kind: MemberModerationKind;
	roomId: string;
	member: MemberView;
}
/**
 * Slice 20's one cross-pane action channel: a ContextMenu inside a list item
 * can't reach the shell that owns the confirm dialog, so it asks instead.
 *
 * Leave and moderation live here because both originate in list rows;
 * everything else (create/join/dm/invite) opens from a header button the shell
 * already owns, so it needs no channel.
 */
export interface ActionsContext {
	requestLeave(target: LeaveTarget): void;
	requestModeration(action: MemberModeration): void;
	/**
	 * Mark a room read from a list row (the room list pane holds no client).
	 * `markRead` is a plain client call, not a dialog: the shell runs it and
	 * the resulting sync clears the badge.
	 */
	requestMarkRead(roomId: string): void;
}
export declare const ActionsKey: InjectionKey<ActionsContext>;
export declare function useActions(): ActionsContext;
/** Undoes one registration. Idempotent — calling it twice is a no-op. */
type Disposable$1 = () => void;
/**
 * Capabilities a plugin may declare in its manifest. Each extension API in
 * `PluginContext` names the permission it requires; the registry refuses the
 * call (and rolls back the install) when the manifest did not declare it.
 *
 * All seven are enforced: `timeline-renderers`, `composer-actions`, `commands`,
 * `member-decorations`, `settings-tabs`, `styles` and `workspace-panes`.
 *
 * This array is the single runtime source: the `Permission` union is derived
 * from it, the release schema's enum is built from it, and the installer
 * refuses a manifest that names anything outside it. Adding a permission
 * means adding it here first.
 */
export declare const PLUGIN_PERMISSIONS: readonly [
	"timeline-renderers",
	"composer-actions",
	"member-decorations",
	"commands",
	"settings-tabs",
	"styles",
	"workspace-panes"
];
export type Permission = (typeof PLUGIN_PERMISSIONS)[number];
/**
 * What a plugin declares about itself. Purely descriptive for built-in
 * plugins; for a third-party plugin the same object is the release document
 * (`tumult.plugin.json`) the installer validates and asks consent for.
 */
export interface PluginManifest {
	/**
	 * Stable, namespaced id — e.g. `cc.jackg.tumult.demo-poll`. The registry
	 * keys installs by it; two installs of one id are refused.
	 */
	id: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	/**
	 * Minimum `@tumult/core` contract version (`CONTRACT_VERSION`) the plugin
	 * understands. Enforced at install: a newer requirement refuses the
	 * install with the shortfall named.
	 */
	minCore?: string;
	/**
	 * Minimum `@tumult/ui` plugin-API version (`PLUGIN_API_VERSION`) the
	 * plugin understands. Enforced at install, same as `minCore`.
	 */
	minUI?: string;
	/** Every extension API the plugin uses. The context enforces these. */
	permissions: Permission[];
	/**
	 * Release artifact only (`tumult.plugin.json` in a plugin repository):
	 * the filename of the built bundle attached to every release, e.g.
	 * `plugin.js`. Absent for plugins compiled into the app; the installer
	 * refuses a release manifest without it.
	 */
	entry?: string;
	/**
	 * Release artifact only: `sha256-<base64>` of the entry bundle, computed
	 * by the template's release workflow from the same file it attaches. The
	 * installer refuses a download that does not hash to this value and
	 * re-checks the stored copy on every boot — what runs is what was hashed.
	 * (Not required by the schema, because the file committed in the plugin
	 * repo has no hash yet; the installer requires it.)
	 */
	integrity?: string;
}
/** Media resolution, passed through from the shell's client. */
export interface PluginMedia {
	/** `mxc://` URI → loadable URL at `size` CSS px (thumbnail, 2x fetch). */
	resolve(uri: string, size: number): Promise<string>;
	/** `mxc://` URI → full (unresized) media as a loadable URL. */
	resolveDownload(uri: string): Promise<string>;
	/** Encrypted attachment descriptor → loadable URL (fetches + decrypts). */
	resolveEncrypted(file: EncryptedAttachment): Promise<string>;
}
/**
 * The registration surface every plugin gets — permission-checked and
 * disposable. New extension points append methods; existing plugins keep
 * working because it only grows.
 */
export interface PluginApi {
	/**
	 * Register a timeline renderer for one Matrix event type (or several,
	 * via one call per type). Returns a disposable that unregisters exactly
	 * this entry.
	 */
	addRenderer(type: string, entry: RendererEntry): Disposable$1;
	/**
	 * Add a button to the composer's action row. The action only runs when a
	 * room and client are present (never in the thread composer today).
	 */
	addComposerAction(action: ComposerAction): Disposable$1;
	/** Register a `/name` slash command for the composer. */
	addCommand(command: Command): Disposable$1;
	/** Add a badge/decoration to member rows that `match` accepts. */
	addMemberDecoration(decoration: MemberDecoration): Disposable$1;
	/** Add a tab to the settings dialog. */
	addSettingsTab(tab: SettingsTab): Disposable$1;
	/**
	 * Add a workspace pane — a top-level region of the shell, opened from a
	 * tile in the guild rail. The pane fills three slots (left nav, content,
	 * bottom bar); the shell keeps its own layout around them.
	 */
	addPane(pane: WorkspacePane): Disposable$1;
	/**
	 * Append a `<style>` element to the document. The CSS applies app-wide
	 * (there is no shadow root to scope into) and must be self-contained:
	 * `@import` and any `url()` other than `data:`, `blob:` or a `#fragment`
	 * throw instead of landing.
	 */
	injectStylesheet(css: string): Disposable$1;
}
/**
 * Everything one plugin can touch during `install()`.
 *
 * Read/write surface on the shell is explicit: data flows through `client`
 * (the `ChatClient` contract — snapshots + subscriptions), navigation through
 * `selection`, cross-pane dialogs through `actions`, and `mxc://` resolution
 * through `media`.
 */
export interface PluginContext extends PluginApi {
	/** This plugin's own manifest (id, name, declared permissions). */
	readonly manifest: PluginManifest;
	/** The chat client — the same contract the UI itself uses. */
	readonly client: ChatClient;
	/** Current room/guild selection and navigation. */
	readonly selection: SelectionContext;
	/** Cross-pane dialog channel (leave, moderation). */
	readonly actions: ActionsContext;
	/** `mxc://` resolvers wired to the client's authenticated media. */
	readonly media: PluginMedia;
}
/**
 * Lifecycle: `install` runs once per install; its returned disposable (and
 * every disposable handed back by the context APIs) is run on uninstall, then
 * `uninstall` (when present) for anything the plugin set up beyond the
 * context — timers, listeners it acquired elsewhere. Installing after a
 * successful uninstall is allowed.
 */
interface Plugin$1 {
	readonly manifest: PluginManifest;
	install(ctx: PluginContext): void | Disposable$1;
	uninstall?(): void;
}
/**
 * Version of the plugin API this build of `@tumult/ui` provides. Bump when a
 * plugin could observe a difference: a new `PluginContext`/`PluginApi`
 * member, a changed permission meaning, a signature change. Additive and
 * invisible changes may keep it.
 */
export declare const PLUGIN_API_VERSION = "1.1.0";
/**
 * Compare two dotted numeric versions ("1.2.3"). Each segment counts its
 * leading integer (`"2-beta"` → 2, missing segments → 0); non-numeric text
 * after the digits is ignored. Returns <0, 0 or >0 like a comparator.
 */
export declare function compareVersions(a: string, b: string): number;
/** `"sandbox"`: loaded in a Worker, bridged. `"trusted"`: loaded in-page. */
export type PluginLane = "sandbox" | "trusted";
/**
 * The permissions the sandbox lane can serve. Everything else hands the host
 * a live component and therefore requires the trusted lane. Keep this list
 * in step with the extension APIs: an API that takes or returns plain data is
 * sandboxable; one that takes a `Component` is not.
 */
export declare const SANDBOXABLE_PERMISSIONS: readonly Permission[];
/**
 * Derive a plugin's lane from its declared permissions: `sandbox` when every
 * permission is sandboxable (including the degenerate none), `trusted` when
 * any component-capable permission appears. The installer calls this before
 * showing consent, so the badge the user sees is this function — not a claim
 * from the manifest.
 */
export declare function deriveLane(manifest: {
	permissions: readonly Permission[];
}): PluginLane;

export {
	Disposable$1 as Disposable,
	NotificationPermission$1 as NotificationPermission,
	Plugin$1 as Plugin,
};

export {};
