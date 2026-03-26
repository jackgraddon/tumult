import dotenv from 'dotenv';
import { BridgeController } from './controller/bridgeController.js';

dotenv.config();

const matrixUrl = process.env.MATRIX_URL || 'https://matrix.org';
const matrixToken = process.env.MATRIX_TOKEN || process.env.MATRIX_ACCESS_TOKEN;
const discordToken = process.env.DISCORD_TOKEN;
const livekitHost = process.env.LIVEKIT_URL || '';
const livekitApiKey = process.env.LIVEKIT_API_KEY || '';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';

if (!matrixToken || !discordToken || !livekitApiKey || !livekitApiSecret) {
    console.error('Missing required environment variables');
    process.exit(1);
}

const controller = new BridgeController(
    matrixUrl,
    matrixToken,
    discordToken,
    livekitHost,
    livekitApiKey,
    livekitApiSecret
);

controller.start().catch(err => {
    console.error('Failed to start bridge:', err);
    process.exit(1);
});

process.on('SIGINT', () => {
    process.exit(0);
});

process.on('SIGTERM', () => {
    process.exit(0);
});
