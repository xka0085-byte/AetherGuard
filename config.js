/**
 * ============================================
 * AetherGuard Discord NFT Bot - 配置文件
 * ============================================
 * 修改说明：
 * - 删除了整个 SUBSCRIPTION_PLANS 对象（FREE/COMMUNITY/PRO）
 * - 删除了 ALCHEMY_NETWORK 配置（固定为 eth-mainnet）
 * - 删除了所有 Redis 相关配置
 * - 删除了 API 服务器相关配置
 * - 从128行精简为约60行
 * ============================================
 */

require('dotenv').config();

module.exports = {
    // ============================================
    // Discord 配置
    // ============================================
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
    },

    // ============================================
    // Alchemy API 配置（区块链查询）
    // ============================================
    alchemy: {
        apiKey: process.env.ALCHEMY_API_KEY,
        // API 请求超时时间（毫秒）
        timeout: 10000,
        // 请求失败重试次数
        retryCount: 3,
        // 重试间隔（毫秒）
        retryDelay: 1000,
    },

    // ============================================
    // 支持的区块链网络
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

    // 默认网络
    defaultNetwork: 'ethereum',

    // ============================================
    // 数据库配置（SQLite）
    // ============================================
    database: {
        // SQLite 数据库文件路径
        path: process.env.DATABASE_PATH || './data.db',
    },

    // ============================================
    // 活跃度追踪配置
    // ============================================
    activity: {
        // 是否启用活跃度追踪
        enabled: process.env.ACTIVITY_ENABLED !== 'false',

        // 活跃度计分规则
        scoring: {
            message: 1,      // 发送消息 +1 分
            reply: 2,        // 回复消息 +2 分
            reaction: 0.5,   // 添加反应 +0.5 分
            voicePerMinute: 0.1,  // 语音每分钟 +0.1 分
        },

        // 消息限制
        minMessageLength: 3,    // 最小消息长度
        cooldownMs: 10000,      // 冷却时间（毫秒）

        // 内存队列配置（替代 Redis）
        queue: {
            // 批量处理大小
            batchSize: 50,
            // 处理间隔（毫秒）
            processInterval: 5000,
        },
    },

    // ============================================
    // NFT 验证配置
    // ============================================
    verification: {
        // 验证结果缓存时间（秒）
        cacheTTL: 300,  // 5分钟
        // 定期检查间隔（小时）
        checkInterval: 24,
        // 默认踢出延迟（小时）
        defaultKickDelay: 24,
    },

    // ============================================
    // 排行榜配置
    // ============================================
    leaderboard: {
        // 默认显示数量
        defaultLimit: 10,
        // 最大显示数量
        maxLimit: 50,
    },

    // ============================================
    // 支付配置（多链多币种：链上转账 + tx 提交）
    // ============================================
    payments: {
        enabled: process.env.PAYMENTS_ENABLED !== 'false',
        // 收款地址（EVM 通用，所有链共用同一个地址）
        receiver: (process.env.PAY_RECEIVER || '').toLowerCase(),
        // 订阅价格（单位：代币最小面值的整数，如 5 = 5 USDC）
        price: process.env.PAY_PRICE || '5',
        // 最低确认数
        minConfirmations: parseInt(process.env.PAY_MIN_CONFIRMATIONS || '1', 10),
        // 可选：订阅角色ID
        subscriberRoleId: process.env.SUBSCRIBER_ROLE_ID || null,
        // 接受的代币列表（合约地址为链上常量，无需 .env）
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
    // 订阅配置
    // ============================================
    subscription: {
        // 当前阶段：beta（前50免费）或 paid（开始收费）
        phase: process.env.SUBSCRIPTION_PHASE || 'beta',
        // 每次订阅时长（天）
        durationDays: parseInt(process.env.SUBSCRIPTION_DURATION_DAYS || '30', 10),
        // 过期后宽限期（天）
        graceDays: parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '3', 10),
        // 早鸟上限（第N个加入的服务器永久优惠）
        foundingLimit: parseInt(process.env.FOUNDING_LIMIT || '50', 10),
    },

    // ============================================
    // 机器人拥有者
    // ============================================
    botOwnerId: process.env.BOT_OWNER_ID || null,

    // ============================================
    // 命令冷却配置
    // ============================================
    cooldown: {
        // 冷却时间（毫秒）
        time: 5000,  // 5秒
    },
};
