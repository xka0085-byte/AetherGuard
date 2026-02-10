/**
 * ============================================
 * AetherGuard Discord NFT Bot - Configuration File
 * ============================================
 * Change Notes:
 * - Removed the entire SUBSCRIPTION_PLANS object (FREE/COMMUNITY/PRO)
 * - Removed ALCHEMY_NETWORK config (fixed to eth-mainnet)
 * - Removed all Redis-related configuration
 * - Removed API server-related configuration
 * - Reduced from 128 lines to approximately 60 lines
 * ============================================
 */

require('dotenv').config();

module.exports = {
    // ============================================
    // Discord Configuration
    // ============================================
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
    },

    // ============================================
    // Alchemy API Configuration (Blockchain Queries)
    // ============================================
    alchemy: {
        apiKey: process.env.ALCHEMY_API_KEY,
        // API request timeout (milliseconds)
        timeout: 10000,
        // Number of retries on request failure
        retryCount: 3,
        // Retry interval (milliseconds)
        retryDelay: 1000,
    },

    // ============================================
    // Supported Blockchain Networks
    // ============================================
    networks: {
        ethereum: {
            name: 'Ethereum',
            alchemyNetwork: 'eth-mainnet',
            displayName: 'Ethereum Mainnet',
            icon: '⟠',
        },
        polygon: {
            name: 'Polygon',
            alchemyNetwork: 'polygon-mainnet',
            displayName: 'Polygon (MATIC)',
            icon: '🟣',
        },
        base: {
            name: 'Base',
            alchemyNetwork: 'base-mainnet',
            displayName: 'Base (Coinbase L2)',
            icon: '🔵',
        },
    },

    // Default network
    defaultNetwork: 'ethereum',

    // ============================================
    // Database Configuration (SQLite)
    // ============================================
    database: {
        // SQLite database file path
        path: process.env.DATABASE_PATH || './data.db',
    },

    // ============================================
    // Activity Tracking Configuration
    // ============================================
    activity: {
        // Whether to enable activity tracking
        enabled: process.env.ACTIVITY_ENABLED !== 'false',

        // Activity scoring rules
        scoring: {
            message: 1,      // Send message +1 point
            reply: 2,        // Reply to message +2 points
            reaction: 0.5,   // Add reaction +0.5 points
            voicePerMinute: 0.1,  // Voice per minute +0.1 points
        },

        // Message limits
        minMessageLength: 3,    // Minimum message length
        cooldownMs: 10000,      // Cooldown time (milliseconds)

        // In-memory queue configuration (replaces Redis)
        queue: {
            // Batch processing size
            batchSize: 50,
            // Processing interval (milliseconds)
            processInterval: 5000,
        },
    },

    // ============================================
    // NFT Verification Configuration
    // ============================================
    verification: {
        // Verification result cache duration (seconds)
        cacheTTL: 300,  // 5 minutes
        // Periodic check interval (hours)
        checkInterval: 24,
        // Default kick delay (hours)
        defaultKickDelay: 24,
    },

    // ============================================
    // Leaderboard Configuration
    // ============================================
    leaderboard: {
        // Default display count
        defaultLimit: 10,
        // Maximum display count
        maxLimit: 50,
    },

    // ============================================
    // Payment Configuration (Multi-chain, multi-token: on-chain transfer + tx submission)
    // ============================================
    payments: {
        enabled: process.env.PAYMENTS_ENABLED !== 'false',
        // Receiver address (EVM universal, same address shared across all chains)
        receiver: (process.env.PAY_RECEIVER || '').toLowerCase(),
        // Subscription price (unit: token smallest denomination, e.g. 5 = 5 USDC)
        price: process.env.PAY_PRICE || '5',
        // Minimum confirmations
        minConfirmations: parseInt(process.env.PAY_MIN_CONFIRMATIONS || '1', 10),
        // Optional: subscriber role ID
        subscriberRoleId: process.env.SUBSCRIBER_ROLE_ID || null,
        // Accepted token list (contract addresses are on-chain constants, no .env needed)
        acceptedTokens: [
            // --- Polygon ---
            { chain: 'polygon', symbol: 'USDC', contract: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6 },
            { chain: 'polygon', symbol: 'USDT', contract: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
            // --- Ethereum ---
            { chain: 'ethereum', symbol: 'USDC', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
            { chain: 'ethereum', symbol: 'USDT', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
            // --- Base ---
            { chain: 'base', symbol: 'USDC', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
        ],
    },

    // ============================================
    // Subscription Configuration
    // ============================================
    subscription: {
        // Current phase: beta (first 50 free) or paid (start charging)
        phase: process.env.SUBSCRIPTION_PHASE || 'beta',
        // Duration per subscription (days)
        durationDays: parseInt(process.env.SUBSCRIPTION_DURATION_DAYS || '30', 10),
        // Grace period after expiration (days)
        graceDays: parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '3', 10),
        // Early bird limit (the Nth server to join gets permanent free access)
        foundingLimit: parseInt(process.env.FOUNDING_LIMIT || '50', 10),
    },

    // ============================================
    // Bot Owner
    // ============================================
    botOwnerId: process.env.BOT_OWNER_ID || null,

    // ============================================
    // Command Cooldown Configuration
    // ============================================
    cooldown: {
        // Cooldown time (milliseconds)
        time: 5000,  // 5 seconds
    },
};