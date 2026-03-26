import { IngressClient, AccessToken } from 'livekit-server-sdk';

export class LiveKitManager {
    private ingressClient: IngressClient;

    constructor(private host: string, private apiKey: string, private secret: string) {
        this.ingressClient = new IngressClient(host, apiKey, secret);
    }

    async generateBridgeToken(roomName: string): Promise<string> {
        const at = new AccessToken(this.apiKey, this.secret, {
            identity: 'discord-bridge',
            name: 'Discord Bridge',
        });
        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });
        return at.toJwt();
    }

    async createDiscordUserIngress(userId: string, displayName: string, roomName: string) {
        // RTP_INPUT maps to value 3 in protocol.
        const ingress = await this.ingressClient.createIngress(3 as any, {
            name: `discord-${userId}`,
            roomName: roomName,
            participantIdentity: `discord::${userId}`,
            participantName: displayName,
            enableTranscoding: false,
        });

        console.log(`[LiveKit] Created ingress for ${userId} in ${roomName}`);
        return ingress;
    }
}
