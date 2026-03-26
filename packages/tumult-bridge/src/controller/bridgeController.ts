import { DiscordGateway } from '../discord/gateway.js';
import { DiscordVoiceConnection } from '../discord/voiceConnection.js';
import { MediasoupManager } from '../router/mediasoupManager.js';
import { LiveKitManager } from '../livekit/manager.js';
import { createClient, MatrixClient } from 'matrix-js-sdk';
import { IngressInfo } from 'livekit-server-sdk';
import dgram from 'dgram';
import { Room as LKRoom, RoomEvent as LKRoomEvent, AudioStream } from '@livekit/rtc-node';
import { OpusEncoder } from '@discordjs/opus';

interface BridgeSession {
    matrixRoomId: string;
    discordGuildId: string;
    discordChannelId: string;
    voiceConnection?: DiscordVoiceConnection;
    participants: Map<string, IngressInfo>;
    forwardSocket: dgram.Socket;
    lkRoom?: LKRoom;
    discordUserTransports: Map<number, any>; // ssrc -> mediasoup transport
    discordVoiceSessionId?: string;
    discordVoiceToken?: string;
    discordVoiceEndpoint?: string;
}

export class BridgeController {
    private matrixClient: MatrixClient;
    private discordGateway: DiscordGateway;
    private mediasoupManager: MediasoupManager;
    private livekitManager: LiveKitManager;
    private sessions = new Map<string, BridgeSession>();
    private opusEncoder = new OpusEncoder(48000, 2);

    constructor(
        matrixUrl: string,
        matrixToken: string,
        discordToken: string,
        livekitHost: string,
        livekitApiKey: string,
        livekitApiSecret: string
    ) {
        this.matrixClient = createClient({
            baseUrl: matrixUrl,
            accessToken: matrixToken,
        });

        this.discordGateway = new DiscordGateway({ token: discordToken });
        this.mediasoupManager = new MediasoupManager();
        this.livekitManager = new LiveKitManager(livekitHost, livekitApiKey, livekitApiSecret);
    }

    async start() {
        await this.mediasoupManager.init();
        await this.discordGateway.connect();

        this.matrixClient.on('RoomState.events' as any, (event: any) => {
            if (event.getType() === 'cc.tumult.bridge.discord') {
                this.handleBridgeState(event);
            }
        });

        this.discordGateway.on('VOICE_SERVER_UPDATE', (data) => this.handleVoiceServerUpdate(data));
        this.discordGateway.on('VOICE_STATE_UPDATE', (data) => this.handleVoiceStateUpdate(data));

        this.discordGateway.on('GUILD_CREATE', (data) => {
            console.log(`[BridgeController] Joined guild ${data.id} (${data.name})`);
        });

        await this.matrixClient.startClient({ initialSyncLimit: 10 });
        console.log('[BridgeController] Bridge started');

        // Initial check for rooms already bridged
        const rooms = this.matrixClient.getRooms();
        for (const room of rooms) {
            const discordEvent = room.currentState.getStateEvents('cc.tumult.bridge.discord', '');
            if (discordEvent) {
                console.log(`[BridgeController] Found existing bridge in ${room.roomId}`);
                this.handleBridgeState(discordEvent);
            }
        }
    }

    private async handleBridgeState(event: any) {
        const content = event.getContent();
        const matrixRoomId = event.getRoomId();

        if (!content.discord_channel_id || !content.discord_guild_id) {
            console.log(`[BridgeController] Removing bridge for ${matrixRoomId}`);
            this.removeSession(matrixRoomId);
            return;
        }

        console.log(`[BridgeController] Linking ${matrixRoomId} to Discord ${content.discord_channel_id}`);
        this.createSession(matrixRoomId, content.discord_guild_id, content.discord_channel_id);
        this.discordGateway.joinVoiceChannel(content.discord_guild_id, content.discord_channel_id);
    }

    private createSession(matrixRoomId: string, guildId: string, channelId: string) {
        if (this.sessions.has(matrixRoomId)) return;

        this.sessions.set(matrixRoomId, {
            matrixRoomId,
            discordGuildId: guildId,
            discordChannelId: channelId,
            participants: new Map(),
            forwardSocket: dgram.createSocket('udp4'),
            discordUserTransports: new Map(),
        });
    }

    private async handleVoiceServerUpdate(data: any) {
        const session = Array.from(this.sessions.values()).find(s => s.discordGuildId === data.guild_id);
        if (!session) return;

        session.discordVoiceToken = data.token;
        session.discordVoiceEndpoint = data.endpoint;

        this.maybeConnectVoice(session);
    }

    private handleVoiceStateUpdate(data: any) {
        if (data.user_id !== this.discordGateway.getUserId()) {
            this.updateDiscordStatusMessage(data.guild_id);
            return;
        }

        const session = Array.from(this.sessions.values()).find(s => s.discordGuildId === data.guild_id);
        if (!session) return;

        session.discordVoiceSessionId = data.session_id;
        this.maybeConnectVoice(session);
    }

    private async maybeConnectVoice(session: BridgeSession) {
        if (session.voiceConnection || !session.discordVoiceSessionId || !session.discordVoiceToken || !session.discordVoiceEndpoint) {
            return;
        }

        console.log(`[BridgeController] Connecting to Discord voice for guild ${session.discordGuildId}`);

        session.voiceConnection = new DiscordVoiceConnection({
            guildId: session.discordGuildId,
            channelId: session.discordChannelId,
            userId: this.discordGateway.getUserId()!,
            sessionId: session.discordVoiceSessionId,
            token: session.discordVoiceToken,
            endpoint: session.discordVoiceEndpoint,
        });

        session.voiceConnection.on('rtp', async (packet: Buffer) => {
            const ssrc = packet.readUInt32BE(8);
            const discordUserId = session.voiceConnection?.ssrcMap.get(ssrc);

            if (discordUserId && !session.participants.has(discordUserId)) {
                await this.setupDiscordParticipant(session, discordUserId, ssrc);
            }

            const transport = session.discordUserTransports.get(ssrc);
            if (transport) {
                session.forwardSocket.send(packet, transport.tuple.localPort, '127.0.0.1');
            }
        });

        await session.voiceConnection.connect();
        await this.setupReturnPath(session);
    }

    private async updateDiscordStatusMessage(guildId: string) {
        // Implementation for Discord bot text message updates
    }

    private async setupDiscordParticipant(session: BridgeSession, userId: string, ssrc: number) {
        console.log(`[BridgeController] Setting up bridge for Discord user ${userId}`);

        const ingress = await this.livekitManager.createDiscordUserIngress(
            userId,
            `Discord User ${userId}`,
            session.matrixRoomId
        );

        session.participants.set(userId, ingress);

        // Mediasoup plumbing
        const transport = await this.mediasoupManager.createPlainTransport(userId, true); // comedia: true
        const producer = await this.mediasoupManager.createProducer(userId, ssrc);

        session.discordUserTransports.set(ssrc, transport);

        // Pipe Producer to LiveKit
        if (ingress.url) {
            const url = new URL(ingress.url);
            const host = url.hostname;
            const port = parseInt(url.port);

            const sendTransport = await this.mediasoupManager.getRouter()!.createPlainTransport({
                listenIp: { ip: '127.0.0.1' },
                rtcpMux: true,
                comedia: false,
            });

            await sendTransport.connect({
                ip: host,
                port: port,
            });

            await sendTransport.consume({
                producerId: producer.id,
                rtpCapabilities: this.mediasoupManager.getRouter()!.rtpCapabilities,
                paused: false,
            });

            console.log(`[BridgeController] Routing mediasoup producer to LiveKit ingress at ${host}:${port}`);
        }
    }

    private async setupReturnPath(session: BridgeSession) {
        const lkRoom = new LKRoom();
        session.lkRoom = lkRoom;

        lkRoom.on(LKRoomEvent.TrackSubscribed, async (track, _pub, participant) => {
            if (track.kind !== 'audio') return;
            if (participant.identity.startsWith('discord::')) return;

            console.log(`[BridgeController] Subscribed to Matrix audio: ${participant.identity}`);
            const stream = new AudioStream(track);

            for await (const frame of stream) {
                const pcm = Buffer.from(frame.data.buffer);
                const opusPacket = this.opusEncoder.encode(pcm);
                session.voiceConnection?.sendRtp(opusPacket);
            }
        });

        const lkUrl = process.env.LIVEKIT_URL!;
        const lkToken = await this.livekitManager.generateBridgeToken(session.matrixRoomId);

        console.log(`[BridgeController] Bridge joining LiveKit room ${session.matrixRoomId}`);
        await lkRoom.connect(lkUrl, lkToken);
    }

    private removeSession(matrixRoomId: string) {
        const session = this.sessions.get(matrixRoomId);
        if (session) {
            console.log(`[BridgeController] Cleaning up session for ${matrixRoomId}`);
            session.forwardSocket.close();
            session.lkRoom?.disconnect();
            session.voiceConnection?.removeAllListeners();
            // In a real implementation, we'd also close mediasoup transports/producers here
            this.sessions.delete(matrixRoomId);
        }
    }
}
