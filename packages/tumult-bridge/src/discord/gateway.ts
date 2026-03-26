import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface DiscordGatewayOptions {
    token: string;
}

export class DiscordGateway extends EventEmitter {
    private ws?: WebSocket;
    private heartbeatInterval?: NodeJS.Timeout;
    private lastSequence: number | null = null;
    private sessionId: string | null = null;
    private userId: string | null = null;

    constructor(private options: DiscordGatewayOptions) {
        super();
    }

    async connect() {
        return new Promise<void>((resolve, reject) => {
            this.ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

            this.ws.on('open', () => {
                console.log('[DiscordGateway] Connected');
            });

            this.ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                this.handleMessage(msg, resolve, reject);
            });

            this.ws.on('error', reject);
            this.ws.on('close', () => {
                this.cleanup();
                this.emit('close');
            });
        });
    }

    private identify() {
        this.ws?.send(JSON.stringify({
            op: 2, // IDENTIFY
            d: {
                token: this.options.token,
                properties: {
                    os: 'linux',
                    browser: 'tumult',
                    device: 'tumult'
                },
                intents: (1 << 7) | (1 << 9) // GUILD_VOICE_STATES | GUILD_MESSAGES
            }
        }));
    }

    private handleMessage(msg: any, resolve: () => void, reject: (err: any) => void) {
        if (msg.s !== undefined) this.lastSequence = msg.s;

        switch (msg.op) {
            case 10: // HELLO
                this.startHeartbeat(msg.d.heartbeat_interval);
                this.identify();
                resolve();
                break;
            case 11: // HEARTBEAT ACK
                break;
            case 0: // DISPATCH
                this.handleDispatch(msg.t, msg.d);
                break;
        }
    }

    private handleDispatch(type: string, data: any) {
        if (type === 'READY') {
            this.sessionId = data.session_id;
            this.userId = data.user.id;
            console.log(`[DiscordGateway] Ready (User: ${this.userId}, Session: ${this.sessionId})`);
        }
        this.emit(type, data);
    }

    joinVoiceChannel(guildId: string, channelId: string) {
        this.ws?.send(JSON.stringify({
            op: 4, // VOICE_STATE_UPDATE
            d: {
                guild_id: guildId,
                channel_id: channelId,
                self_mute: false,
                self_deaf: false
            }
        }));
    }

    private startHeartbeat(interval: number) {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            this.ws?.send(JSON.stringify({
                op: 1, // HEARTBEAT
                d: this.lastSequence
            }));
        }, interval);
    }

    private cleanup() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.ws?.close();
    }

    getSessionId() {
        return this.sessionId;
    }

    getUserId() {
        return this.userId;
    }
}
