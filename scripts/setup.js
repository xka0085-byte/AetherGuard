#!/usr/bin/env node

/**
 * AetherGuard Interactive Setup Wizard
 * Run: npm run setup
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { exec } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question, defaultValue = '') {
    const suffix = defaultValue ? ` (default: ${defaultValue})` : '';
    return new Promise((resolve) => {
        rl.question(`${question}${suffix}: `, (answer) => {
            resolve(answer.trim() || defaultValue);
        });
    });
}

function print(msg) {
    console.log(msg);
}

function printHeader() {
    print('');
    print('='.repeat(50));
    print('  AetherGuard - Setup Wizard');
    print('='.repeat(50));
    print('');
    print('This wizard will help you configure the bot.');
    print('You will need:');
    print('  1. Discord Bot Token');
    print('  2. Discord Application (Client) ID');
    print('  3. Alchemy API Key');
    print('');
    print("Don't have these yet? The wizard will show you where to get them.");
    print('');
}

function checkNodeVersion() {
    const version = process.versions.node;
    const major = parseInt(version.split('.')[0], 10);
    if (major < 18) {
        print(`[ERROR] Node.js >= 18 required. Current: v${version}`);
        print('Download: https://nodejs.org/');
        process.exit(1);
    }
    print(`[OK] Node.js v${version}`);
}

function validateToken(token) {
    return token.split('.').length === 3;
}

function validateClientId(id) {
    return /^\d{17,20}$/.test(id);
}

function validateAlchemyKey(key) {
    return key.length >= 10;
}

function validateWalletAddress(addr) {
    return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/**
 * Verify Discord token online — returns bot username or null
 */
function verifyDiscordToken(token) {
    return new Promise((resolve) => {
        const req = https.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const user = JSON.parse(data);
                        resolve(user.username || 'Unknown');
                    } else {
                        resolve(null);
                    }
                } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
}

/**
 * Verify Alchemy API key online — returns true if valid
 */
function verifyAlchemyKey(key) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
        const req = https.request(`https://eth-mainnet.g.alchemy.com/v2/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(!!json.result);
                } catch { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(10000, () => { req.destroy(); resolve(false); });
        req.write(body);
        req.end();
    });
}

/**
 * Open URL in default browser (cross-platform)
 */
function openBrowser(url) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd, () => {});
}

async function main() {
    printHeader();
    checkNodeVersion();
    print('');

    // Check if .env already exists
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const overwrite = await ask('A .env file already exists. Overwrite? (y/n)', 'n');
        if (overwrite.toLowerCase() !== 'y') {
            print('\nSetup cancelled. Your existing .env was not modified.');
            rl.close();
            return;
        }
    }

    // Quick mode option
    const quickMode = await ask('Use quick mode? (only required fields) (y/n)', 'y');
    const isQuickMode = quickMode.toLowerCase() === 'y';

    // === Required Configuration ===
    print('\n--- Required Configuration ---\n');

    // Discord Token
    let discordToken = '';
    while (true) {
        discordToken = await ask('Discord Bot Token');
        if (!validateToken(discordToken)) {
            print('  [!] Invalid token format.');
            print('      Get it from: https://discord.com/developers/applications > Bot > Reset Token');
            continue;
        }
        print('  Verifying token online...');
        const botName = await verifyDiscordToken(discordToken);
        if (botName) {
            print(`  [OK] Token valid — Bot: ${botName}`);
            break;
        } else {
            print('  [!] Token rejected by Discord. Please check and try again.');
            print('      Make sure you copied the full token from Developer Portal > Bot > Reset Token');
        }
    }

    // Client ID
    let clientId = '';
    while (!validateClientId(clientId)) {
        clientId = await ask('Discord Application (Client) ID');
        if (!validateClientId(clientId)) {
            print('  [!] Invalid Client ID. Should be a 17-20 digit number.');
            print('      Find it at: Developer Portal > General Information > Application ID');
        }
    }
    print('  [OK] Client ID valid');

    // Alchemy Key
    let alchemyKey = '';
    while (true) {
        alchemyKey = await ask('Alchemy API Key');
        if (!validateAlchemyKey(alchemyKey)) {
            print('  [!] Invalid API key. Get one free at: https://www.alchemy.com/');
            continue;
        }
        print('  Verifying Alchemy key online...');
        const valid = await verifyAlchemyKey(alchemyKey);
        if (valid) {
            print('  [OK] Alchemy key valid — blockchain connection working');
            break;
        } else {
            print('  [!] Alchemy key rejected. Please check and try again.');
            print('      Get your key at: https://dashboard.alchemy.com/ > Apps > View Key');
        }
    }

    // === Optional Configuration ===
    let botOwnerId = '';
    let feedbackChannelId = '';
    let payReceiver = '';
    let payPrice = '5';
    let subscriptionPhase = 'beta';

    if (!isQuickMode) {
        print('\n--- Optional Configuration (press Enter to skip) ---\n');

        botOwnerId = await ask('Your Discord User ID (for /bot-stats)');
        if (botOwnerId && !validateClientId(botOwnerId)) {
            print('  [!] Warning: ID format looks incorrect, saving anyway');
        }

        feedbackChannelId = await ask('Feedback Channel ID');

        payReceiver = await ask('Payment receiver wallet address');
        if (payReceiver && !validateWalletAddress(payReceiver)) {
            print('  [!] Warning: Address format looks incorrect, saving anyway');
        }

        payPrice = await ask('Subscription price (USDC/USDT)', '5');
        subscriptionPhase = await ask('Subscription phase (beta/paid)', 'beta');
    }

    // === Generate .env ===
    const walletEncKey = crypto.randomBytes(32).toString('hex');
    const envContent = [
        '# AetherGuard - Environment Configuration',
        '# Generated by setup wizard',
        '',
        '# ==================== Discord ====================',
        `DISCORD_TOKEN=${discordToken}`,
        `DISCORD_CLIENT_ID=${clientId}`,
        '',
        '# ==================== Alchemy ====================',
        `ALCHEMY_API_KEY=${alchemyKey}`,
        '',
        '# ==================== Database ====================',
        'DATABASE_PATH=./data.db',
        '',
        '# ==================== Security ====================',
        `WALLET_ENCRYPTION_KEY=${walletEncKey}`,
        '',
        '# ==================== Activity ====================',
        'ACTIVITY_ENABLED=true',
        '',
        '# ==================== Subscription ====================',
        `SUBSCRIPTION_PHASE=${subscriptionPhase}`,
        'FOUNDING_LIMIT=50',
        '',
        '# ==================== Payment ====================',
        `PAYMENTS_ENABLED=${payReceiver ? 'true' : 'false'}`,
        `PAY_RECEIVER=${payReceiver}`,
        `PAY_PRICE=${payPrice}`,
        '',
        '# ==================== Optional ====================',
        `BOT_OWNER_ID=${botOwnerId}`,
        `FEEDBACK_CHANNEL_ID=${feedbackChannelId}`,
    ].join('\n') + '\n';

    fs.writeFileSync(envPath, envContent);
    print('\n[OK] .env file created successfully!');

    // === Check dependencies ===
    const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
        print('\n[!] node_modules not found. Run: npm install');
    } else {
        print('[OK] Dependencies installed');
    }

    // === Invite URL ===
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=269569088&scope=bot%20applications.commands`;

    print('\n' + '='.repeat(50));
    print('  Setup Complete!');
    print('='.repeat(50));
    print('');
    print('IMPORTANT: Make sure you enabled these Privileged Intents:');
    print('  Discord Developer Portal > Bot > Enable:');
    print('  [x] SERVER MEMBERS INTENT');
    print('  [x] MESSAGE CONTENT INTENT');
    print('');

    // Offer to open invite URL in browser
    const openInvite = await ask('Open bot invite link in browser now? (y/n)', 'y');
    if (openInvite.toLowerCase() === 'y') {
        print('  Opening browser...');
        openBrowser(inviteUrl);
    } else {
        print('  Invite URL (copy and open in browser):');
        print(`  ${inviteUrl}`);
    }

    print('');
    print('Next: Start the bot with:');
    print('  npm start');
    print('');
    print('Then in your Discord server, run:');
    print('  /setup contract:<NFT_ADDRESS> chain:ethereum role:@YourRole amount:1');
    print('');

    rl.close();
}

main().catch((err) => {
    console.error('Setup failed:', err.message);
    rl.close();
    process.exit(1);
});
