# AetherGuard - Discord NFT Verification Bot

A multi-chain Discord bot for NFT ownership verification, activity tracking, leaderboards, and subscription-based monetization.

## Features

- **Multi-Chain NFT Verification** - Verify NFT ownership on Ethereum, Polygon, Base, Arbitrum, and Optimism
- **Auto Role Assignment** - Automatically grant/revoke roles based on NFT holdings
- **Activity Tracking** - Track messages, replies, reactions, and voice time with customizable scoring
- **Leaderboard** - Weekly and all-time activity leaderboards
- **Periodic Re-verification** - Automatically re-check NFT holdings every 24 hours
- **Payment & Subscription** - Accept USDC/USDT payments on-chain for Pro subscriptions
- **NFT Holding Bonus** - Holders with more NFTs earn higher activity score multipliers
- **Daily Caps** - Anti-abuse daily point limits to prevent score farming
- **Security Logging** - Audit logs, rate limiting, and suspicious behavior detection
- **New Member Welcome** - Automatically DMs new members with verification instructions
- **Feedback System** - Users can submit bug reports and feature requests

### Anti-Sybil & Anti-Farming Protection

- **Gibberish Detection** - Filters out low-quality messages (keyboard mashing, excessive repetition, special character spam)
- **Voice AFK Detection** - Muted+deafened users get 0 credit, single mute/deafen gets 50%, 4-hour session cap
- **Reaction Pattern Analysis** - Limits reactions to 30 per 5 minutes, detects mass-reacting to same messages
- **Activity Anomaly Detection** - Flags users with sudden activity spikes (5x their 7-day average)
- **Cross-Guild Sybil Detection** - Flags wallets verified in 10+ guilds
- **Progressive Penalty System** - 1 flag = warning, 2 flags = 50% score, 3+ flags = blocked from scoring

## Tech Stack

- **Discord.js** v14
- **SQLite** (sqlite3)
- **Alchemy SDK** (Ethereum, Polygon, Base, Arbitrum, Optimism)
- **Node.js** >= 18
- **node-cron** (scheduled tasks)
- **node-cache** (caching)
- **PM2** (optional, for production process management)

## Commands

### Admin Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/setup` | Configure NFT verification (contract, chain, role, min amount) | Administrator |
| `/activity-setup` | Configure activity tracking (scoring, daily caps, NFT bonus, leaderboard channel) | Administrator (Pro) |
| `/activity-overview` | View all members' activity data with filtering and sorting | Administrator (Pro) |

### User Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/verify` | Verify your NFT ownership with a wallet address | Everyone |
| `/my-activity` | View your personal activity statistics | Everyone |
| `/leaderboard` | View server activity leaderboard (weekly / all-time) | Everyone |
| `/help` | View bot usage help and command reference | Everyone |
| `/feedback` | Submit a bug report, feature request, or question | Everyone |
| `/subscribe` | View subscription pricing and payment instructions | Everyone |
| `/pay` | Submit a payment transaction hash for verification | Everyone |

### Owner Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/bot-stats` | View bot-wide statistics (guilds, subscriptions, phase) | Bot Owner |

---

## Quick Start

**Prerequisites:** Node.js >= 18, [Discord Bot Token](https://discord.com/developers/applications), [Alchemy API Key](https://www.alchemy.com/)

**Deploy in 3 commands:**

```bash
git clone https://github.com/xka0085-byte/AetherGuard.git && cd AetherGuard
npm install && npm run setup
npm start
```

The setup wizard will guide you through configuration. No manual file editing needed.

---

## Deployment Options

### Option A: Standard (Node.js)

Best for: local development, VPS, any server with Node.js

```bash
git clone https://github.com/xka0085-byte/AetherGuard.git
cd AetherGuard
npm install
npm run setup
npm start
```

### Option B: Docker

Best for: production servers, isolated environments

```bash
git clone https://github.com/xka0085-byte/AetherGuard.git
cd AetherGuard
npm run setup          # Create .env first
docker-compose up -d   # Start in background
```

Useful Docker commands:
```bash
docker-compose logs -f    # View logs
docker-compose restart    # Restart bot
docker-compose down       # Stop bot
```

### Option C: One-Click Deploy

Deploy directly to a cloud platform (no local setup needed):

| Platform | Free Tier | Deploy |
|----------|-----------|--------|
| [Railway](https://railway.app) | 500 hours/month | Fork repo > New Project > Deploy from GitHub |
| [Render](https://render.com) | Free for background workers | Fork repo > New Background Worker > Connect repo |

After deploying, set these environment variables in the platform dashboard:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `ALCHEMY_API_KEY`

---

## Detailed Setup Guide

### Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**, give it a name (e.g. "AetherGuard"), and click **Create**
3. On the **General Information** page, copy the **Application ID** (this is your `DISCORD_CLIENT_ID`)

### Step 2: Create the Bot User

1. In the left sidebar, click **"Bot"**
2. Click **"Reset Token"** and copy the token (this is your `DISCORD_TOKEN`)
   - **Important:** Store this token securely. You will not be able to see it again.
3. Enable the following **Privileged Gateway Intents** (scroll down on the Bot page):
   - **SERVER MEMBERS INTENT** - Required for detecting new members and fetching member info
   - **MESSAGE CONTENT INTENT** - Required for activity tracking (message length validation)

   **Note:** The bot also uses these intents (enabled by default, no action needed):
   - Guilds (default) - Access to guild information
   - Guild Messages (default) - Receive message events
   - Guild Message Reactions (default) - Track reactions for activity scoring
   - Guild Voice States (default) - Track voice channel activity
4. Click **Save Changes**

### Step 3: Get an Alchemy API Key

1. Go to [Alchemy](https://www.alchemy.com/) and create a free account
2. Create a new app (any name, select Ethereum Mainnet)
3. Copy your **API Key** from the app dashboard (this is your `ALCHEMY_API_KEY`)
   - The same API key works for all supported chains (Ethereum, Polygon, Base, Arbitrum, Optimism)

### Step 4: Install and Configure

```bash
# Clone the project
git clone https://github.com/xka0085-byte/AetherGuard.git
cd AetherGuard

# Install dependencies
npm install

# Run the setup wizard (creates .env automatically)
npm run setup
```

Requirements:
- Node.js >= 18
- npm (comes with Node.js)

**Manual configuration (alternative to setup wizard):**

```bash
cp .env.example .env
# Edit .env with your values
```

<details>
<summary>Click to see all environment variables</summary>

**Required:**

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Step 2 |
| `DISCORD_CLIENT_ID` | Application ID from Step 1 |
| `ALCHEMY_API_KEY` | Alchemy API key from Step 3 |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_OWNER_ID` | - | Your Discord user ID (enables `/bot-stats`) |
| `FEEDBACK_CHANNEL_ID` | - | Channel ID where feedback is sent |
| `DATABASE_PATH` | `./data.db` | Path to the SQLite database file |
| `ACTIVITY_ENABLED` | `true` | Enable/disable activity tracking globally |
| `PAYMENTS_ENABLED` | `true` | Enable/disable the payment system |
| `PAY_RECEIVER` | - | Your EVM wallet address to receive payments |
| `PAY_PRICE` | `5` | Subscription price in USDC/USDT |
| `PAY_MIN_CONFIRMATIONS` | `1` | Minimum blockchain confirmations for payment |
| `SUBSCRIBER_ROLE_ID` | - | Role ID granted to paying subscribers |
| `SUBSCRIPTION_PHASE` | `beta` | `beta` (first N guilds free) or `paid` |
| `SUBSCRIPTION_DURATION_DAYS` | `30` | Subscription duration in days |
| `SUBSCRIPTION_GRACE_DAYS` | `3` | Grace period after subscription expires |
| `FOUNDING_LIMIT` | `50` | Number of early guilds that get free access |

</details>

### Step 5: Invite the Bot to Your Server

1. Go back to the [Discord Developer Portal](https://discord.com/developers/applications), select your application
2. In the left sidebar, click **"OAuth2"**
3. Under **OAuth2 URL Generator**:
   - **Scopes**: check `bot` and `applications.commands`
   - **Bot Permissions**: check the following:
     - Manage Roles
     - Send Messages
     - Embed Links
     - Read Message History
     - Add Reactions
     - View Channels
     - Connect (for voice activity tracking)
4. Copy the generated URL at the bottom and open it in your browser
5. Select the server you want to add the bot to, and click **Authorize**

Or use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=269569088&scope=bot%20applications.commands
```

**Important:** Make sure the bot's role is placed **above** the verified role in your server's role hierarchy (Server Settings > Roles). The bot cannot assign roles that are higher than its own role.

### Step 6: Start the Bot

```bash
# Standard start
npm start

# Development mode (auto-restart on file changes)
npm run dev

# Production with PM2 (recommended for servers)
npm run start:pm2

# Docker
docker-compose up -d
```

You should see output like:
```
✅ Bot logged in: AetherGuard#1234
✅ Slash commands registered
✅ Synced 1 guild(s) to database
✅ All modules initialized
```

### Step 7: Configure Your Server

Once the bot is online and in your server:

**1. Set up NFT verification:**
```
/setup contract:<NFT_CONTRACT_ADDRESS> chain:<ethereum|polygon|base|arbitrum|optimism> role:@VerifiedRole amount:1
```

Example:
```
/setup contract:0x1234...abcd chain:ethereum role:@NFT Holder amount:1
```

**2. (Optional) Set up activity tracking (Pro feature):**
```
/activity-setup enabled:True message_score:1 reply_score:2 reaction_score:0.5 voice_score:0.1
```

You can also configure daily caps and NFT bonus in the same command:
```
/activity-setup enabled:True daily_message_cap:100 daily_reply_cap:50 nft_bonus:True leaderboard_channel:#leaderboard
```

**3. Users can now verify themselves:**
```
/verify wallet:0xYourWalletAddress
```

---

## Free Tier vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| NFT Verification | Up to 50 verified members | Unlimited |
| Leaderboard | Weekly only, Top 10 | Weekly + All-Time, Top 50 |
| `/activity-setup` | Not available | Full access |
| `/activity-overview` | Not available | Full access |

During the **beta phase**, the first 50 guilds to join get permanent free Pro access ("Founding Guilds"). After switching to the **paid phase**, new guilds need to subscribe via `/subscribe` and `/pay`.

## Supported Payment Tokens

| Chain | Token | Contract |
|-------|-------|----------|
| Polygon | USDC | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` |
| Polygon | USDT | `0xc2132d05d31c914a87c6611c10748aeb04b58e8f` |
| Ethereum | USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` |
| Ethereum | USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` |
| Base | USDC | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |

Polygon is recommended for low gas fees.

## Activity Scoring

### Default Scores

| Activity | Points |
|----------|--------|
| Send a message | +1 |
| Reply to a message | +2 |
| Add a reaction | +0.5 |
| Voice (per minute) | +0.1 |

All values are customizable per-server via `/activity-setup`.

### Default Daily Caps

| Activity | Cap |
|----------|-----|
| Messages | 100 points/day |
| Replies | 50 points/day |
| Reactions | 50 points/day |
| Voice | 120 minutes/day |

### NFT Holding Bonus

When enabled via `/activity-setup nft_bonus:True`:

| NFT Count | Multiplier |
|-----------|------------|
| 1 NFT | 1.0x (normal) |
| 3+ NFTs | 1.2x (20% bonus) |
| 5+ NFTs | 1.5x (50% bonus) |

## Scheduled Tasks

| Schedule | Task |
|----------|------|
| Every hour | Re-check NFT holdings for expired verifications |
| Every Monday 00:00 | Reset weekly activity scores |
| Every day 12:00 | Post leaderboard to configured channels |

## Security Features

- **Command Cooldown** - 5-second cooldown between commands per user
- **Verify Rate Limit** - Max 2 verifications per minute, 10 per hour
- **Wallet Uniqueness** - Each wallet can only be used by one user per server
- **Daily Activity Caps** - Prevent score farming
- **Suspicious Behavior Detection** - Flags excessive verify attempts and command spam
- **Audit Logging** - All admin actions and security events are logged to `logs/`

## Project Structure

```
├── index.js                  # Main entry point (commands, events, cron)
├── config.js                 # Configuration (env vars, defaults)
├── ecosystem.config.js       # PM2 process manager config
├── Dockerfile                # Docker container definition
├── docker-compose.yml        # Docker Compose configuration
├── refresh-commands.js       # Utility: force re-register slash commands
├── .env.example              # Environment variables template
├── package.json
├── README.md
├── TESTING.md                # Testing guide
├── database/
│   ├── db.js                 # Database operations (CRUD)
│   └── schema.sql            # Database schema (6 tables)
├── modules/
│   ├── checkNFT.js           # NFT ownership verification (multi-chain)
│   ├── activityTracker.js    # Activity tracking (messages, voice, reactions)
│   ├── leaderboard.js        # Leaderboard generation and posting
│   └── payment.js            # On-chain payment verification (ERC-20)
├── utils/
│   └── securityLogger.js     # Security events, audit logs, behavior tracking
├── scripts/
│   └── setup.js              # Interactive setup wizard
├── logs/                     # Generated log files
│   ├── security.log
│   ├── audit.log
│   └── user_activity.log
```

## FAQ (Frequently Asked Questions)

### How long does deployment take?
**10-15 minutes** for first-time setup:
- 2-3 minutes: Create Discord bot and get Alchemy API key
- 2 minutes: Clone repo and install dependencies
- 1 minute: Run setup wizard
- 5 minutes: Invite bot and configure with `/setup`

### Do I need a server to run this bot?
Yes, the bot needs to run 24/7 on a server. Options:
- **Free hosting**: Railway (500 hours/month), Render (free tier)
- **VPS**: DigitalOcean ($6/month), Vultr ($5/month), AWS EC2
- **Local**: Your own computer (must stay online)

### Can I use this bot for free?
Yes! The bot itself is free and open-source. You only need:
- **Alchemy API**: Free tier (300M compute units/month) is enough for small-medium servers
- **Hosting**: Free options available (Railway, Render) or paid VPS ($5-10/month)

### What if I don't have a credit card for Alchemy?
Alchemy's free tier doesn't require a credit card. Just sign up with email. If you exceed the free tier, you can:
- Use multiple Alchemy accounts (one per chain)
- Switch to other RPC providers (Infura, QuickNode)
- Self-host an Ethereum node (advanced)

### Can I monetize this bot?
Yes! The MIT license allows commercial use. You can:
- Charge servers a subscription fee (built-in payment system)
- Offer it as a managed service
- Add premium features

**Important**: If you run it as a paid service, you must write your own Terms of Service and Privacy Policy (see Legal Disclaimer section).

### How do I update the bot when new versions are released?
```bash
cd AetherGuard
git pull origin main
npm install  # Update dependencies if needed
npm start    # Restart bot
```

### Can I customize the bot for my needs?
Absolutely! The code is open-source and well-documented. Common customizations:
- Change subscription pricing (`PAY_PRICE` in .env)
- Add more chains (edit `NETWORK_MAP` in modules/checkNFT.js)
- Modify activity scoring rules (modules/activityTracker.js)
- Add custom commands (index.js)

### Is my data secure?
The bot includes security features:
- Wallet addresses encrypted with AES-256-GCM (if `WALLET_ENCRYPTION_KEY` is set)
- Security event logging and audit trails
- Rate limiting on sensitive commands
- No data sent to third parties (except Alchemy for blockchain queries)

**Important**: Keep your `.env` file secure and never commit it to Git.

---

## Troubleshooting

### Bot cannot send DMs
Users need to enable "Allow direct messages from server members" in their Discord privacy settings.

### NFT verification fails
- Double-check the contract address.
- Make sure the contract is on the correct chain (Ethereum/Polygon/Base).
- Verify the wallet actually holds the NFT using a block explorer.

### Slash commands not showing
- Wait 1-2 minutes for Discord to sync global commands.
- Try pressing `Ctrl+R` in Discord to force reload.
- Run `node refresh-commands.js` to force re-register commands.
- Make sure the bot was invited with the `applications.commands` scope.

### Bot cannot assign roles
- The bot's role must be **above** the target role in the server role hierarchy.
- Go to Server Settings > Roles, drag the bot's role above the verified role.

### Payment verification fails
- Ensure you selected the correct chain when using `/pay`.
- Wait for at least 1 block confirmation before submitting.
- The transfer must be for the exact token and amount to the configured receiver address.

### Commands show "Pro subscription required"
- During the beta phase, the first 50 guilds have free access.
- After switching to paid phase, use `/subscribe` to see payment instructions, then `/pay` to activate.

## Support the Project

If you find AetherGuard useful, consider supporting development with a donation:

**Wallet Address:** `0xc70f7c61caa5c8d88f7cdeb022683d9a15199948`

Accepted on any EVM chain (Ethereum, Polygon, Base, Arbitrum, Optimism, etc.)

---

## License & Legal Disclaimer

**License**: MIT License - Free to use, modify, and distribute (including commercial use)

**Important Legal Notice**:

This is open-source software provided "as-is" without warranties. The author (repository owner) is NOT a service provider and does NOT operate any hosted instances of this bot.

**If you deploy this bot (especially as a paid service), YOU are responsible for**:
- Writing your own Terms of Service and Privacy Policy
- Complying with applicable laws (GDPR, data protection, consumer protection, etc.)
- Handling user data securely and legally
- Any legal issues arising from your deployment

**About the Payment Module**:
The payment system (`/subscribe`, `/pay` commands) is an OPTIONAL FEATURE that allows deployers to monetize their bot instances. You can:
- Keep it enabled and charge users (you handle all legal compliance)
- Disable it by setting `PAYMENTS_ENABLED=false` in your `.env`
- Remove the payment code entirely if you don't need it

The author receives NO revenue from others using this payment feature. It's simply a tool provided in the codebase for those who want to run a paid service.
