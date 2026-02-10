/**
 * ============================================
 * AetherGuard Discord NFT Bot - Main Entry
 * ============================================
 * 11 slash commands:
 *   /setup, /activity-setup, /activity-overview,
 *   /verify, /my-activity, /leaderboard, /help,
 *   /feedback, /bot-stats, /subscribe, /pay
 *
 * Multi-chain: Ethereum, Polygon, Base
 * Payment: USDC/USDT on-chain subscription
 * Security: rate limiting, audit logs, daily caps
 * ============================================
 */

require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');

// 导入模块
const db = require('./database/db');
const { checkNFTOwnership } = require('./modules/checkNFT');
const activityTrackerModule = require('./modules/activityTracker');
const leaderboardModule = require('./modules/leaderboard');
const config = require('./config');
const securityLogger = require('./utils/securityLogger');
const { verifyPayment, getAcceptedTokens, getSupportedPayChains } = require('./modules/payment');

// ============================================
// 全局错误处理 (防止进程崩溃)
// ============================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    // 保持进程存活，或依赖 PM2 重启
});

// ============================================
// 错误消息定义（中文友好）
// ============================================
const ERROR_MESSAGES = {
    INVALID_ADDRESS: '❌ Invalid wallet address\nPlease enter a valid Ethereum address (42 characters starting with 0x)',
    NFT_NOT_FOUND: '❌ NFT not found\nYour wallet does not hold the required NFT',
    NFT_INSUFFICIENT: '❌ Insufficient NFTs\nYou hold {current} NFT(s), but at least {required} are required',
    API_TIMEOUT: '⏱️ Request timeout\nBlockchain API timed out, please try again later',
    API_ERROR: '⚠️ API error\nUnable to connect to blockchain API, please try again later',
    RATE_LIMIT: '🚫 Too many requests\nPlease wait {seconds} seconds before trying again',
    NOT_CONFIGURED: '⚙️ Server not configured\nAdministrator please use /setup command first',
    NO_PERMISSION: '🔒 Permission denied\nOnly administrators can use this command',
    DATABASE_ERROR: '💾 Database error\nPlease try again later, contact admin if issue persists',
    UNKNOWN_ERROR: '❓ Unknown error\nAn unexpected error occurred, please try again later'
};

// 免费版验证人数上限（测试时可临时改为 2）
const FREE_VERIFY_LIMIT = 50;

// ============================================
// 命令冷却系统
// ============================================
const cooldowns = new Map();
const COOLDOWN_TIME = 5000; // 5秒冷却

// ============================================
// 用户级速率限制（改进版）
// ============================================
const userRateLimits = new Map();

/**
 * 检查用户速率限制
 * @param {string} guildId 服务器ID
 * @param {string} userId 用户ID
 * @returns {{allowed: boolean, reason: string}}
 */
function checkUserRateLimit(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const ONE_MINUTE = 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;
    
    if (!userRateLimits.has(key)) {
        userRateLimits.set(key, []);
    }
    
    const timestamps = userRateLimits.get(key);
    const validTimestamps = timestamps.filter(t => now - t < ONE_HOUR);
    userRateLimits.set(key, validTimestamps);
    
    // 1分钟内最多2次
    const lastMinute = validTimestamps.filter(t => now - t < ONE_MINUTE);
    if (lastMinute.length >= 2) {
        const waitSeconds = Math.ceil((lastMinute[0] + ONE_MINUTE - now) / 1000);
        return { allowed: false, reason: `Max 2 verifications per minute. Please wait ${waitSeconds} seconds` };
    }
    
    // 1小时内最多10次
    if (validTimestamps.length >= 10) {
        const waitMinutes = Math.ceil((validTimestamps[0] + ONE_HOUR - now) / 60000);
        return { allowed: false, reason: `Max 10 verifications per hour. Please wait ${waitMinutes} minutes` };
    }
    
    validTimestamps.push(now);
    return { allowed: true, reason: '' };
}

// 每10分钟清理过期记录
setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    for (const [key, timestamps] of userRateLimits.entries()) {
        const valid = timestamps.filter(t => now - t < ONE_HOUR);
        if (valid.length === 0) {
            userRateLimits.delete(key);
        } else {
            userRateLimits.set(key, valid);
        }
    }
}, 10 * 60 * 1000);

// ============================================
// /pay 独立速率限制（防滥用/防刷API）
// ============================================
const payRateLimits = new Map(); // key: `${guildId}:${userId}` -> number[] timestamps(ms)

function checkPayRateLimit(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const FIVE_MIN = 5 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  const arr = payRateLimits.get(key) || [];
  const recent = arr.filter(t => now - t < ONE_HOUR);

  // 1 小时最多 3 次
  if (recent.length >= 3) {
    const waitMin = Math.ceil((recent[0] + ONE_HOUR - now) / 60000);
    return { allowed: false, reason: `Max 3 payment verifications per hour. Please wait ${waitMin} minute(s).` };
  }

  // 5 分钟内最多 1 次
  const last5min = recent.filter(t => now - t < FIVE_MIN);
  if (last5min.length >= 1) {
    const waitSec = Math.ceil((last5min[0] + FIVE_MIN - now) / 1000);
    return { allowed: false, reason: `Max 1 payment verification per 5 minutes. Please wait ${waitSec} second(s).` };
  }

  recent.push(now);
  payRateLimits.set(key, recent);
  return { allowed: true, reason: '' };
}

// 定期清理过期记录（每 10 分钟）
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  for (const [key, timestamps] of payRateLimits.entries()) {
    const valid = timestamps.filter(t => now - t < ONE_HOUR);
    if (valid.length) payRateLimits.set(key, valid);
    else payRateLimits.delete(key);
  }
}, 10 * 60 * 1000);


/**
 * 检查用户是否在冷却中
 * @param {string} userId - 用户ID
 * @returns {number|false} 剩余冷却时间（秒）或false
 */
function checkCooldown(userId) {
    const now = Date.now();

    if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME;
        if (now < expirationTime) {
            return ((expirationTime - now) / 1000).toFixed(1);
        }
    }

    cooldowns.set(userId, now);
    return false;
}

// 定期清理过期的冷却记录（每5分钟）
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamp] of cooldowns.entries()) {
        if (now - timestamp > COOLDOWN_TIME) {
            cooldowns.delete(userId);
        }
    }
}, 5 * 60 * 1000);

// ============================================
// 订阅与权限检查助手
// ============================================
async function canUsePro(guildId) {
    const sub = config.subscription || {};
    if (sub.phase !== 'paid') return true; // beta: always allow
    const founding = await db.isFoundingGuild(guildId, sub.foundingLimit ?? 50);
    if (founding) return true;
    return await db.isGuildSubscribed(guildId, sub.graceDays || 0);
}

function isOwner(userId) {
    return !!config.botOwnerId && userId === config.botOwnerId;
}

// ============================================
// Discord客户端初始化
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ============================================
// 斜杠命令定义（8个命令）
// ============================================
const commands = [
    // /setup - Configure NFT verification (only NFT-related options)
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure NFT verification system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('contract')
                .setDescription('NFT contract address')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('chain')
                .setDescription('Blockchain network')
                .setRequired(true)
                .addChoices(
                    { name: '⟠ Ethereum Mainnet', value: 'ethereum' },
                    { name: '🟣 Polygon (MATIC)', value: 'polygon' },
                    { name: '🔵 Base (Coinbase L2)', value: 'base' }
                ))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to assign after verification')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Minimum NFT amount required')
                .setRequired(false)
                .setMinValue(1)),

    // /activity-setup - Configure activity tracking (admin only)
    new SlashCommandBuilder()
        .setName('activity-setup')
        .setDescription('Configure activity tracking system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable/disable activity tracking')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('message_score')
                .setDescription('Points per message (default: 1)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        .addNumberOption(option =>
            option.setName('reply_score')
                .setDescription('Points per reply (default: 2)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        .addNumberOption(option =>
            option.setName('reaction_score')
                .setDescription('Points per reaction (default: 0.5)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        .addNumberOption(option =>
            option.setName('voice_score')
                .setDescription('Points per voice minute (default: 0.1)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        // 每日积分上限选项
        .addIntegerOption(option =>
            option.setName('daily_message_cap')
                .setDescription('Daily message point cap (default: 100)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1000))
        .addIntegerOption(option =>
            option.setName('daily_reply_cap')
                .setDescription('Daily reply point cap (default: 50)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(500))
        .addIntegerOption(option =>
            option.setName('daily_reaction_cap')
                .setDescription('Daily reaction point cap (default: 50)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(500))
        .addIntegerOption(option =>
            option.setName('daily_voice_cap')
                .setDescription('Daily voice minutes cap (default: 120)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1440))
        // NFT持有量加成选项
        .addBooleanOption(option =>
            option.setName('nft_bonus')
                .setDescription('Enable NFT holding bonus (more NFTs = higher multiplier)')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('leaderboard_channel')
                .setDescription('Channel for leaderboard posts')
                .setRequired(false)),

    // /activity-overview - View all members activity (admin only)
    new SlashCommandBuilder()
        .setName('activity-overview')
        .setDescription('View activity overview for all server members')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('start_date')
                .setDescription('Start date (YYYY-MM-DD)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('end_date')
                .setDescription('End date (YYYY-MM-DD)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('sort_by')
                .setDescription('Sort by field')
                .setRequired(false)
                .addChoices(
                    { name: 'Total Score', value: 'total_score' },
                    { name: 'Weekly Score', value: 'week_score' },
                    { name: 'Messages', value: 'message_count' },
                    { name: 'Replies', value: 'reply_count' },
                    { name: 'Voice Minutes', value: 'voice_minutes' }
                ))
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number (default: 1)')
                .setRequired(false)
                .setMinValue(1)),

    // /verify - Verify NFT ownership
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify your NFT ownership')
        .addStringOption(option =>
            option.setName('wallet')
                .setDescription('Your wallet address (0x...)')
                .setRequired(true)),

    // /my-activity - View personal activity
    new SlashCommandBuilder()
        .setName('my-activity')
        .setDescription('View your activity statistics'),

    // /leaderboard - View leaderboard
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View server activity leaderboard')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Leaderboard type')
                .setRequired(false)
                .addChoices(
                    { name: 'All Time', value: 'total' },
                    { name: 'Weekly', value: 'week' }
                )),

    // /help - Help documentation
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('View bot usage help'),

    // /feedback - User feedback
    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Send feedback or suggestions to developers')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Feedback type')
                .setRequired(true)
                .addChoices(
                    { name: 'Bug Report', value: 'bug' },
                    { name: 'Feature Request', value: 'feature' },
                    { name: 'Question', value: 'question' },
                    { name: 'Other', value: 'other' }
                ))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Feedback content (max 500 characters)')
                .setRequired(true)
                .setMaxLength(500)),

    // /bot-stats - Owner only
    new SlashCommandBuilder()
        .setName('bot-stats')
        .setDescription('Owner-only: view bot stats'),

    // /subscribe - Show payment info
    new SlashCommandBuilder()
        .setName('subscribe')
        .setDescription('View subscription info and payment instructions'),

    // /pay - Submit tx hash for verification
    new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Submit a payment transaction for verification')
        .addStringOption(option =>
            option.setName('chain')
                .setDescription('Blockchain network used for payment')
                .setRequired(true)
                .addChoices(
                    { name: '🟣 Polygon (recommended, low gas)', value: 'polygon' },
                    { name: '⟠ Ethereum', value: 'ethereum' },
                    { name: '🔵 Base', value: 'base' }
                ))
        .addStringOption(option =>
            option.setName('tx')
                .setDescription('Transaction hash (0x...)')
                .setRequired(true)),
];

// ============================================
// 注册斜杠命令
// ============================================
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );

        console.log('✅ Slash commands registered');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }
}

// ============================================
// 命令处理函数
// ============================================

/**
 * 处理 /setup 命令 (仅NFT验证相关)
 */
async function handleSetup(interaction) {
    const guildId = interaction.guildId;
    const contract = interaction.options.getString('contract');
    const chain = interaction.options.getString('chain');
    const role = interaction.options.getRole('role');
    const amount = interaction.options.getInteger('amount') || 1;

    // 验证合约地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
        return interaction.reply({
            content: ERROR_MESSAGES.INVALID_ADDRESS,
            ephemeral: true
        });
    }

    // 立即响应，防止3秒超时
    await interaction.deferReply({ ephemeral: true });

    // 获取链的显示名称
    const chainNames = {
        ethereum: '⟠ Ethereum',
        polygon: '🟣 Polygon',
        base: '🔵 Base'
    };
    const chainDisplay = chainNames[chain] || chain;

    try {
        // 获取旧配置（用于审计日志）
        const oldConfig = await db.getCommunity(guildId);

        // 保存配置到数据库
        await db.upsertCommunity({
            guildId,
            nftContractAddress: contract,
            chain,
            requiredAmount: amount,
            verifiedRoleId: role.id
        });

        // 记录管理员操作审计日志
        securityLogger.logAuditEvent(securityLogger.AUDIT_EVENTS.SETUP_NFT, {
            guildId,
            guildName: interaction.guild.name,
            adminId: interaction.user.id,
            adminTag: interaction.user.tag,
            previousValues: oldConfig ? {
                contract: oldConfig.nft_contract_address,
                chain: oldConfig.chain,
                amount: oldConfig.required_amount,
                role: oldConfig.verified_role_id
            } : null,
            newValues: {
                contract,
                chain,
                amount,
                role: role.id
            }
        });

        // Build success message
        const embed = new EmbedBuilder()
            .setTitle('✅ NFT Verification Configured')
            .setColor(0x00ff00)
            .addFields(
                { name: '🔗 Blockchain', value: chainDisplay, inline: true },
                { name: '🔢 Min Amount', value: `${amount}`, inline: true },
                { name: '🎭 Verified Role', value: `${role}`, inline: true },
                { name: '📜 NFT Contract', value: `\`${contract}\``, inline: false }
            )
            .setFooter({ text: 'Users can now use /verify command | Use /activity-setup to configure activity tracking' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Setup error:', error);
        await interaction.editReply({
            content: ERROR_MESSAGES.DATABASE_ERROR
        });
    }
}

/**
 * 处理 /activity-setup 命令 (管理员配置活跃度追踪)
 */
async function handleActivitySetup(interaction) {
    const guildId = interaction.guildId;
    const enabled = interaction.options.getBoolean('enabled');
    const messageScore = interaction.options.getNumber('message_score') ?? 1.0;
    const replyScore = interaction.options.getNumber('reply_score') ?? 2.0;
    const reactionScore = interaction.options.getNumber('reaction_score') ?? 0.5;
    const voiceScore = interaction.options.getNumber('voice_score') ?? 0.1;
    // 每日积分上限
    const dailyMessageCap = interaction.options.getInteger('daily_message_cap') ?? 100;
    const dailyReplyCap = interaction.options.getInteger('daily_reply_cap') ?? 50;
    const dailyReactionCap = interaction.options.getInteger('daily_reaction_cap') ?? 50;
    const dailyVoiceCap = interaction.options.getInteger('daily_voice_cap') ?? 120;
    // NFT持有量加成
    const nftBonusEnabled = interaction.options.getBoolean('nft_bonus') ?? false;
    const leaderboardChannel = interaction.options.getChannel('leaderboard_channel');

    // 立即响应，防止3秒超时
    await interaction.deferReply({ ephemeral: true });

    try {
        // 获取旧配置（用于审计日志）
        const oldSettings = await db.getActivitySettings(guildId);

        // 保存活跃度设置
        await db.upsertActivitySettings({
            guildId,
            enabled: enabled ? 1 : 0,
            messageScore,
            replyScore,
            reactionScore,
            voiceScore,
            dailyMessageCap,
            dailyReplyCap,
            dailyReactionCap,
            dailyVoiceCap,
            nftBonusEnabled: nftBonusEnabled ? 1 : 0,
            leaderboardChannelId: leaderboardChannel?.id || null
        });

        // 记录管理员操作审计日志
        securityLogger.logAuditEvent(securityLogger.AUDIT_EVENTS.SETUP_ACTIVITY, {
            guildId,
            guildName: interaction.guild.name,
            adminId: interaction.user.id,
            adminTag: interaction.user.tag,
            changes: {
                enabled,
                messageScore,
                replyScore,
                reactionScore,
                voiceScore,
                dailyMessageCap,
                dailyReplyCap,
                dailyReactionCap,
                dailyVoiceCap,
                nftBonusEnabled,
                leaderboardChannel: leaderboardChannel?.id || null
            },
            previousValues: oldSettings ? {
                enabled: oldSettings.enabled,
                nftBonusEnabled: oldSettings.nft_bonus_enabled
            } : null
        });

        const embed = new EmbedBuilder()
            .setTitle('📊 Activity Tracking Configured')
            .setColor(enabled ? 0x00ff00 : 0xff9900)
            .addFields(
                { name: '⚡ Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: '💬 Message Score', value: `${messageScore} pts`, inline: true },
                { name: '↩️ Reply Score', value: `${replyScore} pts`, inline: true },
                { name: '😀 Reaction Score', value: `${reactionScore} pts`, inline: true },
                { name: '🎤 Voice Score', value: `${voiceScore} pts/min`, inline: true },
                { name: '🏆 Leaderboard Channel', value: leaderboardChannel ? `${leaderboardChannel}` : 'Not set', inline: true }
            )
            .addFields(
                { name: '📅 Daily Caps', value:
                    `Messages: ${dailyMessageCap}\n` +
                    `Replies: ${dailyReplyCap}\n` +
                    `Reactions: ${dailyReactionCap}\n` +
                    `Voice: ${dailyVoiceCap} min`, inline: true },
                { name: '💎 NFT Bonus', value:
                    nftBonusEnabled ?
                    '✅ Enabled\n• 1 NFT: 1.0x\n• 3+ NFT: 1.2x\n• 5+ NFT: 1.5x' :
                    '❌ Disabled', inline: true }
            )
            .setFooter({ text: 'Activity scoring will apply to future activities' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Activity setup error:', error);
        await interaction.editReply({
            content: ERROR_MESSAGES.DATABASE_ERROR
        });
    }
}

/**
 * 处理 /activity-overview 命令 (管理员查看所有成员活跃度)
 */
async function handleActivityOverview(interaction) {
    const guildId = interaction.guildId;
    const startDate = interaction.options.getString('start_date');
    const endDate = interaction.options.getString('end_date');
    const sortBy = interaction.options.getString('sort_by') || 'total_score';
    const page = interaction.options.getInteger('page') || 1;
    const pageSize = 15;

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
        return interaction.reply({
            content: '❌ Invalid start date format. Please use YYYY-MM-DD',
            ephemeral: true
        });
    }
    if (endDate && !dateRegex.test(endDate)) {
        return interaction.reply({
            content: '❌ Invalid end date format. Please use YYYY-MM-DD',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // 获取活跃度设置
        const settings = await db.getActivitySettings(guildId);
        if (!settings || !settings.enabled) {
            return interaction.editReply({
                content: '📊 Activity tracking is not enabled. Use /activity-setup to enable it.'
            });
        }

        // 获取统计摘要
        const summary = await db.getActivitySummary(guildId);

        // 获取活跃度数据
        const activityData = await db.getAllActivityData(guildId, {
            limit: pageSize,
            offset: (page - 1) * pageSize,
            startDate,
            endDate,
            sortBy,
            sortOrder: 'DESC'
        });

        if (activityData.length === 0) {
            return interaction.editReply({
                content: '📊 No activity data found for the specified period.'
            });
        }

        // 构建排行榜描述
        let description = '';
        const sortLabels = {
            total_score: 'Total Score',
            week_score: 'Weekly Score',
            message_count: 'Messages',
            reply_count: 'Replies',
            voice_minutes: 'Voice Minutes'
        };

        for (let i = 0; i < activityData.length; i++) {
            const entry = activityData[i];
            const rank = (page - 1) * pageSize + i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            description += `${medal} <@${entry.user_id}> - **${entry[sortBy]}** ${sortLabels[sortBy]}\n`;
            description += `   💬 ${entry.message_count} | ↩️ ${entry.reply_count} | 😀 ${entry.reaction_count} | 🎤 ${entry.voice_minutes}min\n`;
        }

        const totalPages = Math.ceil((summary?.total_users || 0) / pageSize);
        const dateRange = startDate || endDate
            ? `\n📅 Period: ${startDate || 'Start'} ~ ${endDate || 'Now'}`
            : '';

        const embed = new EmbedBuilder()
            .setTitle('📊 Server Activity Overview')
            .setColor(0x5865f2)
            .setDescription(description)
            .addFields(
                { name: '👥 Total Users', value: `${summary?.total_users || 0}`, inline: true },
                { name: '💬 Total Messages', value: `${summary?.total_messages || 0}`, inline: true },
                { name: '⭐ Avg Score', value: `${Math.round(summary?.avg_score || 0)}`, inline: true }
            )
            .setFooter({ text: `Page ${page}/${totalPages || 1} | Sorted by ${sortLabels[sortBy]}${dateRange}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Activity overview error:', error);
        await interaction.editReply({
            content: ERROR_MESSAGES.DATABASE_ERROR
        });
    }
}

/**
 * 处理 /verify 命令
 */
async function handleVerify(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const wallet = interaction.options.getString('wallet').trim();

    // 立即响应，防止3秒超时
    await interaction.deferReply({ ephemeral: true });

    // ===== 速率限制检查 =====
    const rateLimitCheck = checkUserRateLimit(guildId, userId);
    if (!rateLimitCheck.allowed) {
        // 记录速率限制事件
        securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.RATE_LIMIT_VERIFY, {
            guildId,
            userId,
            userTag: interaction.user.tag,
            details: { reason: rateLimitCheck.reason }
        });
        securityLogger.trackUserBehavior(guildId, userId, 'verify', { blocked: true, reason: 'rate_limit' });

        return interaction.editReply({
            content: `⏱️ Verification Rate Limit\n${rateLimitCheck.reason}\n\nThis is to prevent abuse and protect API quota.`
        });
    }
    // ===== 速率限制检查结束 =====

    // 追踪用户验证行为
    securityLogger.trackUserBehavior(guildId, userId, 'verify', { wallet: wallet.slice(0, 10) + '...' });

    // 获取社区配置
    const community = await db.getCommunity(guildId);
    if (!community) {
        return interaction.editReply({
            content: ERROR_MESSAGES.NOT_CONFIGURED
        });
    }

    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        // 记录无效地址尝试
        securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.VERIFY_INVALID_ADDRESS, {
            guildId,
            userId,
            userTag: interaction.user.tag,
            details: { wallet: wallet.slice(0, 20) + '...' }
        });
        return interaction.editReply({
            content: ERROR_MESSAGES.INVALID_ADDRESS
        });
    }

    try {
        // 获取链的显示名称
        const chainNames = {
            ethereum: '⟠ Ethereum',
            polygon: '🟣 Polygon',
            base: '🔵 Base'
        };
        const chain = community.chain || 'ethereum';
        const chainDisplay = chainNames[chain] || chain;

        // 检查NFT持有（传入链参数）
        const nftResult = await checkNFTOwnership(
            wallet,
            community.nft_contract_address,
            community.required_amount,
            chain
        );

        if (!nftResult.success) {
            // 验证失败
            let errorMessage = ERROR_MESSAGES.NFT_NOT_FOUND;

            if (nftResult.balance > 0) {
                errorMessage = ERROR_MESSAGES.NFT_INSUFFICIENT
                    .replace('{current}', nftResult.balance)
                    .replace('{required}', community.required_amount);
            }

            // 记录验证失败事件
            securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.VERIFY_FAILED, {
                guildId,
                userId,
                userTag: interaction.user.tag,
                details: {
                    balance: nftResult.balance,
                    required: community.required_amount,
                    contract: community.nft_contract_address,
                    chain
                }
            });

            const failEmbed = new EmbedBuilder()
                .setTitle('Verification Failed')
                .setColor(0xff0000)
                .setDescription(errorMessage)
                .addFields(
                    { name: '🔗 Blockchain', value: chainDisplay, inline: true },
                    { name: '🔢 Required', value: `${community.required_amount} NFT(s)`, inline: true },
                    { name: '📜 NFT Contract', value: `\`${community.nft_contract_address}\``, inline: false },
                    { name: '💡 Suggestion', value: `Please ensure you hold the required NFT on **${chainDisplay}** and try again`, inline: false }
                )
                .setTimestamp();

            return interaction.editReply({ embeds: [failEmbed] });
        }

        // 钱包地址唯一性检查（防止多用户共享同一钱包绕过NFT门控）
        const walletUsedByOther = await db.isWalletUsedByOther(guildId, userId, wallet);
        if (walletUsedByOther) {
            return interaction.editReply({
                content: '❌ This wallet address is already verified by another user in this server.\nEach wallet can only be used by one user per server.'
            });
        }

        // 免费版验证人数限制检查
        const isPro = await canUsePro(guildId);
        if (!isPro) {
            const existingUser = await db.getVerifiedUser(guildId, userId);
            if (!existingUser) {
                const verifiedCount = await db.getVerifiedCount(guildId);
                if (verifiedCount >= FREE_VERIFY_LIMIT) {
                    return interaction.editReply({
                        content: `🔒 This server has reached the free tier limit of ${FREE_VERIFY_LIMIT} verified members.\nUpgrade to Pro to verify unlimited members! Use /subscribe for details.`
                    });
                }
            }
        }

        // 验证成功，保存到数据库
        await db.upsertVerifiedUser({
            guildId,
            userId,
            walletAddress: wallet,
            nftBalance: nftResult.balance
        });

        // 分配角色
        const member = await interaction.guild.members.fetch(userId);
        if (community.verified_role_id) {
            await member.roles.add(community.verified_role_id);
        }

        // 记录验证成功事件
        securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.VERIFY_SUCCESS, {
            guildId,
            userId,
            userTag: interaction.user.tag,
            details: {
                nftBalance: nftResult.balance,
                roleAssigned: community.verified_role_id,
                chain
            }
        });
        securityLogger.logAuditEvent(securityLogger.AUDIT_EVENTS.USER_VERIFIED, {
            guildId,
            guildName: interaction.guild.name,
            targetUserId: userId,
            changes: {
                nftBalance: nftResult.balance,
                roleId: community.verified_role_id,
                chain
            }
        });

        // Build success message
        const successEmbed = new EmbedBuilder()
            .setTitle('🎉 Verification Successful!')
            .setColor(0x00ff00)
            .setDescription('Your NFT ownership has been verified')
            .addFields(
                { name: '🔗 Blockchain', value: chainDisplay, inline: true },
                { name: '💎 NFT Count', value: `${nftResult.balance}`, inline: true },
                { name: '🎭 Role Granted', value: community.verified_role_id ? `<@&${community.verified_role_id}>` : 'None', inline: true },
                { name: '📜 Contract', value: `\`${community.nft_contract_address}\``, inline: false },
                { name: '⏰ Next Check', value: 'Auto-check in 24 hours', inline: false }
            )
            .setFooter({ text: `Keep holding NFT on ${chainDisplay} to maintain verified status` })
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Verify error:', error);

        let errorMessage = ERROR_MESSAGES.UNKNOWN_ERROR;
        if (error.message.includes('timeout')) {
            errorMessage = ERROR_MESSAGES.API_TIMEOUT;
        } else if (error.message.includes('rate')) {
            errorMessage = ERROR_MESSAGES.API_ERROR;
        }

        await interaction.editReply({ content: errorMessage });
    }
}

/**
 * 处理 /my-activity 命令
 */
async function handleMyActivity(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // 检查是否启用活跃度追踪
    const settings = await db.getActivitySettings(guildId);
    if (!settings || !settings.enabled) {
        return interaction.reply({
            content: '📊 Activity tracking is not enabled on this server',
            ephemeral: true
        });
    }

    const activity = await db.getUserActivity(guildId, userId);

    if (!activity) {
        return interaction.reply({
            content: '📊 No activity data yet\nStart interacting in the server to build up activity!',
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('📊 Your Activity Statistics')
        .setColor(0x5865f2)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
            { name: '💬 Messages', value: `${activity.message_count}`, inline: true },
            { name: '↩️ Replies', value: `${activity.reply_count}`, inline: true },
            { name: '😀 Reactions', value: `${activity.reaction_count}`, inline: true },
            { name: '🎤 Voice', value: `${activity.voice_minutes} min`, inline: true },
            { name: '⭐ Total Score', value: `${activity.total_score}`, inline: true },
            { name: '📅 Weekly Score', value: `${activity.week_score}`, inline: true }
        )
        .setFooter({ text: `Last active: ${activity.last_active}` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * 处理 /leaderboard 命令
 */
async function handleLeaderboard(interaction) {
    const guildId = interaction.guildId;
    const userChoice = interaction.options.getString('type'); // null = 没选

    // Check if activity tracking is enabled
    const settings = await db.getActivitySettings(guildId);
    if (!settings || !settings.enabled) {
        return interaction.reply({
            content: '📊 Activity tracking is not enabled on this server',
            ephemeral: true
        });
    }

    // 免费版限制：仅 Weekly，Top 10；Pro：允许 All Time，Top 50
    const isPro = await canUsePro(guildId);
    let limit, type;
    if (!isPro) {
        if (userChoice === 'total') {
            return interaction.reply({
                content: '🔒 All-Time leaderboard is a Pro feature.\nFree servers can only view the **Weekly** leaderboard.\nUse `/subscribe` to upgrade!',
                ephemeral: true
            });
        }
        type = 'week';
        limit = 10;
    } else {
        type = userChoice || 'total';
        limit = 50;
    }

    const leaderboard = await db.getLeaderboard(guildId, limit, type);

    if (leaderboard.length === 0) {
        return interaction.reply({
            content: '🏆 No leaderboard data yet',
            ephemeral: true
        });
    }

    const scoreField = type === 'week' ? 'week_score' : 'total_score';
    const title = type === 'week' ? '📅 Weekly Activity Leaderboard' : '🏆 All-Time Activity Leaderboard';

    let description = '';
    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        description += `${medal} <@${entry.user_id}> - **${entry[scoreField]}** pts\n`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xffd700)
        .setDescription(description)
        .setFooter({ text: `${interaction.guild.name} | ${leaderboard.length} users on leaderboard` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

/**
 * 处理 /subscribe 命令 — 显示支付信息（多链多币种）
 */
async function handleSubscribe(interaction) {
    const pay = config.payments;
    if (!pay.enabled || !pay.receiver) {
        return interaction.reply({ content: '⚙️ Payment system is not configured yet.', ephemeral: true });
    }

    const chains = getSupportedPayChains();
    if (chains.length === 0) {
        return interaction.reply({ content: '⚙️ No accepted tokens configured.', ephemeral: true });
    }

    // 按链分组显示接受的代币
    const tokenFields = chains.map(chain => {
        const info = config.networks[chain] || { displayName: chain, icon: '🔗' };
        const tokens = getAcceptedTokens(chain);
        const tokenList = tokens.map(t => `• **${t.symbol}** \`${t.contract}\``).join('\n');
        return {
            name: `${info.icon} ${info.displayName}`,
            value: tokenList,
            inline: false,
        };
    });

    const embed = new EmbedBuilder()
        .setTitle('💳 Subscription Payment')
        .setColor(0x00b894)
        .setDescription(
            `Send **${pay.price} USDC/USDT** to the address below on any supported chain, then use \`/pay\` to submit your transaction hash.`
        )
        .addFields(
            { name: 'Receiver Address', value: `\`${pay.receiver}\``, inline: false },
            { name: 'Amount', value: `${pay.price} (USDC or USDT)`, inline: true },
        )
        .addFields(tokenFields)
        .addFields(
            {
                name: '📋 Steps',
                value:
                    '1. Transfer the exact amount to the address above\n' +
                    '2. Wait for the transaction to confirm\n' +
                    '3. Copy the transaction hash\n' +
                    '4. Use `/pay chain:<chain> tx:<your_tx_hash>` to verify',
                inline: false,
            }
        )
        .addFields(
            {
                name: '⚠️ Disclaimer',
                value:
                    '• Service provided "as is", no 100% uptime guarantee.\n' +
                    '• Crypto payments are non-refundable.\n' +
                    '• User assumes all on-chain risks.\n' +
                    '• Data collected: Discord ID, Wallet Hash.\n' +
                    '• Service may be terminated at any time.',
                inline: false
            }
        )
        .setFooter({ text: 'AetherGuard Payment • Polygon recommended (low gas fees)' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * 处理 /pay 命令 — 验证交易并赋予角色（多链多币种）
 */
async function handlePay(interaction) {
    const pay = config.payments;
    if (!pay.enabled || !pay.receiver) {
        return interaction.reply({ content: '⚙️ Payment system is not configured yet.', ephemeral: true });
    }

    const chain = interaction.options.getString('chain');
    const txHash = interaction.options.getString('tx').trim();

    // 先做 /pay 限流
    {
      const rl = checkPayRateLimit(interaction.guildId, interaction.user.id);
      if (!rl.allowed) {
        return interaction.reply({
          content: `⏱️ Payment verification rate limited.\n${rl.reason}`,
          ephemeral: true
        });
      }
    }

    // 要求用户先绑定钱包（/verify），并用该钱包付款
    const verified = await db.getVerifiedUser(interaction.guildId, interaction.user.id);
    if (!verified || !verified.wallet_address) {
      return interaction.reply({
        content: '🔒 Please verify your wallet first using `/verify <wallet>`. Payments must be sent from your verified wallet address.',
        ephemeral: true
      });
    }

    // 校验 tx hash 格式
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return interaction.reply({ content: '❌ Invalid transaction hash. It should be 66 characters starting with 0x.', ephemeral: true });
    }

    // 检查是否已提交过
    const existing = await db.getPaymentByTx(txHash);
    if (existing) {
        return interaction.reply({ content: '⚠️ This transaction has already been submitted.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // 链上验证（传入 chain）
    const result = await verifyPayment(txHash, chain);

    if (!result.ok) {
        const msgs = {
            PAYMENTS_DISABLED: 'Payment system is currently disabled.',
            NO_RECEIVER: 'Payment receiver not configured.',
            UNSUPPORTED_CHAIN: 'This chain is not supported.',
            NO_TOKENS_ON_CHAIN: 'No accepted tokens configured for this chain.',
            TX_NOT_FOUND: 'Transaction not found on chain. Please wait for confirmation and try again.',
            TX_REVERTED: 'Transaction was reverted (failed). Please check and try again.',
            INSUFFICIENT_CONFIRMATIONS: 'Transaction does not have enough confirmations yet. Please wait and retry.',
            INSUFFICIENT_AMOUNT: `Amount is less than the required ${pay.price} ${result.symbol || 'tokens'}.`,
            NO_MATCHING_TRANSFER: 'No matching token transfer to our address found in this transaction. Make sure you selected the correct chain.',
            RPC_ERROR: 'Blockchain query failed. Please try again later.',
        };
        return interaction.editReply({ content: `❌ ${msgs[result.error] || 'Verification failed.'}` });
    }

    // 记录到数据库（防止竞态条件：如果返回 false 说明已被其他请求抢先记录）
    const recorded = await db.recordPayment({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        chain: result.chain,
        txHash,
        tokenContract: result.token,
        receiver: result.to,
        payer: result.from,
        amountRaw: result.amount,
        amountDecimals: result.decimals,
    });

    if (!recorded) {
        return interaction.editReply({ content: '⚠️ This transaction has already been submitted.' });
    }

    // 激活或续订服务器级订阅
    const subCfg = config.subscription || {};
    const durationDays = subCfg.durationDays || 30;
    const { endAt } = await db.createOrExtendSubscription({
        guildId: interaction.guildId,
        payerUserId: interaction.user.id,
        chain: result.chain,
        txHash,
        amountRaw: result.amount,
        amountDecimals: result.decimals,
        durationDays,
    });

    const chainInfo = config.networks[result.chain] || { icon: '🔗', displayName: result.chain };
    const endDate = new Date(endAt);
    await interaction.editReply({ content: `✅ Payment verified! (${result.symbol} on ${chainInfo.icon} ${chainInfo.displayName})\nYour server subscription is active until ${endDate.toISOString().slice(0,10)}.` });
}

/**
 * 处理 /help 命令
 */
async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('📖 AetherGuard Help')
        .setColor(0x5865f2)
        .setDescription('AetherGuard is an NFT verification bot with activity tracking and anti-abuse features.')
        .addFields(
            {
                name: '🔐 NFT Verification (Admin)',
                value:
                    '`/setup` - Configure NFT verification\n' +
                    '• contract: NFT contract address (required)\n' +
                    '• role: Verified role (required)\n' +
                    '• amount: Min NFT amount (default: 1)',
                inline: false
            },
            {
                name: '📊 Activity Tracking (Admin)',
                value:
                    '`/activity-setup` - Configure activity tracking\n' +
                    '• enabled: Enable/disable tracking\n' +
                    '• message/reply/reaction/voice_score: Points per action\n' +
                    '• daily_*_cap: Daily point caps (anti-abuse)\n' +
                    '• nft_bonus: Enable NFT holding multiplier\n' +
                    '• leaderboard_channel: Leaderboard channel\n\n' +
                    '`/activity-overview` - View all members activity',
                inline: false
            },
            {
                name: '💎 NFT Holding Bonus',
                value:
                    'When enabled, NFT holders get point multipliers:\n' +
                    '• 1 NFT: 1.0x (normal)\n' +
                    '• 3+ NFTs: 1.2x (20% bonus)\n' +
                    '• 5+ NFTs: 1.5x (50% bonus)',
                inline: false
            },
            {
                name: '👤 User Commands',
                value:
                    '`/verify <wallet>` - Verify NFT ownership\n' +
                    '`/my-activity` - View your activity stats\n' +
                    '`/leaderboard [type]` - View activity leaderboard\n' +
                    '`/subscribe` - View payment info\n' +
                    '`/pay <tx>` - Submit payment tx hash',
                inline: false
            },
            {
                name: '⚠️ Notes',
                value:
                    '• Supports: Ethereum, Polygon, Base\n' +
                    '• Wallet address: 42 chars starting with 0x\n' +
                    '• Command cooldown: 5 seconds\n' +
                    '• Daily caps prevent score farming',
                inline: false
            }
        )
        .setFooter({ text: 'AetherGuard NFT Verification Bot' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * 处理 /feedback 命令
 */
async function handleFeedback(interaction) {
    const feedbackType = interaction.options.getString('type');
    const feedbackMessage = interaction.options.getString('message');
    const feedbackChannelId = process.env.FEEDBACK_CHANNEL_ID;

    // Check if feedback channel is configured
    if (!feedbackChannelId) {
        return interaction.reply({
            content: 'Feedback feature is not enabled. Please contact the bot administrator.',
            ephemeral: true
        });
    }

    try {
        // Get feedback channel
        const feedbackChannel = await client.channels.fetch(feedbackChannelId);
        if (!feedbackChannel) {
            return interaction.reply({
                content: 'Feedback channel not found. Please contact the bot administrator.',
                ephemeral: true
            });
        }

        // Feedback type mapping
        const typeLabels = {
            bug: 'Bug Report',
            feature: 'Feature Request',
            question: 'Question',
            other: 'Other'
        };

        const typeColors = {
            bug: 0xff0000,      // 红色
            feature: 0x00ff00,  // 绿色
            question: 0x0099ff, // 蓝色
            other: 0x808080     // 灰色
        };

        // Build feedback embed
        const feedbackEmbed = new EmbedBuilder()
            .setTitle(`📬 New Feedback - ${typeLabels[feedbackType]}`)
            .setColor(typeColors[feedbackType])
            .addFields(
                { name: '👤 User', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '🏠 Server', value: `${interaction.guild.name}`, inline: true },
                { name: '📝 Message', value: feedbackMessage, inline: false }
            )
            .setThumbnail(interaction.user.displayAvatarURL())
            .setFooter({ text: `User ID: ${interaction.user.id} | Server ID: ${interaction.guild.id}` })
            .setTimestamp();

        // Send to feedback channel
        await feedbackChannel.send({ embeds: [feedbackEmbed] });

        // Reply to user
        await interaction.reply({
            content: '✅ Thank you for your feedback! We have received your message and will review it soon.',
            ephemeral: true
        });

    } catch (error) {
        console.error('Feedback error:', error);
        await interaction.reply({
            content: 'Failed to send feedback. Please try again later.',
            ephemeral: true
        });
    }
}

// ============================================
// 事件处理
// ============================================

/**
 * 处理 /bot-stats 命令（仅机器人拥有者）
 */
async function handleBotStats(interaction) {
    if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: '🔒 Owner only', ephemeral: true });
    }
    const sub = config.subscription || {};
    const stats = await db.getBotStats(sub.foundingLimit ?? 50, sub.graceDays ?? 0);

    const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Stats')
        .setColor(0x5865f2)
        .addFields(
            { name: 'Phase', value: String(sub.phase || 'beta'), inline: true },
            { name: 'Guilds', value: String(stats.totalGuilds), inline: true },
            { name: `Founding guilds (≤ ${sub.foundingLimit ?? 50})`, value: String(stats.foundingCount), inline: true },
            { name: 'Active subscriptions', value: String(stats.activeSubscriptions), inline: true },
        )
        .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ============================================
// 事件处理
// ============================================

// 机器人就绪事件
client.once('ready', async () => {
    console.log(`✅ Bot logged in: ${client.user.tag}`);

    // 初始化数据库
    await db.initDatabase();

    // 注册命令
    await registerCommands();

    // 初始化活跃度追踪器
    activityTrackerModule.initActivityTracker();

    // 初始化排行榜管理器
    leaderboardModule.initLeaderboard(client);

    // 设置定时任务
    setupCronJobs();

    // 同步已加入的服务器到数据库
    try {
        for (const [id, guild] of client.guilds.cache) {
            await db.addGuildIfNotExists(id, guild.name);
        }
        console.log(`✅ Synced ${client.guilds.cache.size} guild(s) to database`);
    } catch (e) {
        console.error('Failed to sync guilds:', e);
    }

    // 记录机器人启动事件
    securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.BOT_STARTED, {
        details: {
            botTag: client.user.tag,
            guildCount: client.guilds.cache.size,
            startTime: new Date().toISOString()
        }
    });

    console.log('✅ All modules initialized');
});

// 新成员加入事件（发送验证提示）
client.on('guildMemberAdd', async (member) => {
    try {
        // 检查是否配置了NFT验证
        const community = await db.getCommunity(member.guild.id);
        if (!community || !community.nft_contract_address) {
            return; // 未配置NFT验证，不发送提示
        }

        // 验证角色是否存在
        const verifiedRole = member.guild.roles.cache.get(community.verified_role_id);
        const roleDisplay = verifiedRole ? `<@&${community.verified_role_id}>` : '`角色已删除，请联系管理员`';

        // 构建欢迎消息
        const description = `Welcome <@${member.user.id}>!\n\n` +
            `This server requires NFT verification to gain the verified role.\n\n` +
            `**To verify:** Use the \`/verify\` command with your wallet address.\n\n` +
            `**📋 Verification Requirements:**\n` +
            `• Contract: \`${community.nft_contract_address}\`\n` +
            `• Minimum NFTs: \`${community.required_amount || 1}\`\n` +
            `• Verified Role: ${roleDisplay}`;

        const embed = new EmbedBuilder()
            .setTitle('🎉 Welcome to ' + member.guild.name + '!')
            .setColor(0x5865f2)
            .setDescription(description)
            .setFooter({ text: 'Use /verify to get verified role' })
            .setTimestamp();

        // 发送私信给新成员
        try {
            await member.send({ embeds: [embed] });
            console.log(`✅ Sent verification reminder to ${member.user.tag}`);
        } catch (dmError) {
            // 如果无法发送私信，尝试在系统频道发送
            console.log(`⚠️ Could not DM ${member.user.tag}, trying fallback channel`);

            const fallbackChannel = member.guild.systemChannel;
            if (fallbackChannel) {
                await fallbackChannel.send({ content: `<@${member.user.id}>`, embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('Error handling new member:', error);
    }
});

client.on('guildCreate', async (guild) => {
    try {
        await db.addGuildIfNotExists(guild.id, guild.name);
        console.log(`✅ Joined guild: ${guild.name} (${guild.id})`);
    } catch (e) {
        console.error('Failed to handle guildCreate:', e);
    }
});

client.on('guildDelete', async (guild) => {
    try {
        await db.markGuildLeft(guild.id);
        console.log(`⚠️ Left guild: ${guild.name || guild.id}`);
    } catch (e) {
        console.error('Failed to handle guildDelete:', e);
    }
});

// 交互事件（斜杠命令）
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // 追踪用户命令行为
    securityLogger.trackUserBehavior(interaction.guildId, interaction.user.id, 'command', {
        command: interaction.commandName
    });

    // 检查冷却
    const cooldownRemaining = checkCooldown(interaction.user.id);
    if (cooldownRemaining) {
        // 记录命令冷却触发
        securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.RATE_LIMIT_COMMAND, {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            details: {
                command: interaction.commandName,
                cooldownRemaining
            }
        });
        return interaction.reply({
            content: ERROR_MESSAGES.RATE_LIMIT.replace('{seconds}', cooldownRemaining),
            ephemeral: true
        });
    }

    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'setup':
                await handleSetup(interaction);
                break;
            case 'activity-setup':
                if (!(await canUsePro(interaction.guildId))) {
                    await interaction.reply({
                        content: `🔒 This command requires a Pro subscription.\nUse /subscribe to see payment info, then pay and submit with /pay to activate your server subscription.`,
                        ephemeral: true,
                    });
                    break;
                }
                await handleActivitySetup(interaction);
                break;
            case 'activity-overview':
                if (!(await canUsePro(interaction.guildId))) {
                    await interaction.reply({
                        content: `🔒 This command requires a Pro subscription.\nUse /subscribe and /pay to activate your server subscription.`,
                        ephemeral: true,
                    });
                    break;
                }
                await handleActivityOverview(interaction);
                break;
            case 'bot-stats':
                await handleBotStats(interaction);
                break;
            case 'verify':
                await handleVerify(interaction);
                break;
            case 'my-activity':
                await handleMyActivity(interaction);
                break;
            case 'leaderboard':
                await handleLeaderboard(interaction);
                break;
            case 'help':
                await handleHelp(interaction);
                break;
            case 'feedback':
                await handleFeedback(interaction);
                break;
            case 'subscribe':
                await handleSubscribe(interaction);
                break;
            case 'pay':
                await handlePay(interaction);
                break;
            default:
                await interaction.reply({
                    content: 'Unknown command',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error(`Command error (${commandName}):`, error);

        const errorReply = {
            content: ERROR_MESSAGES.UNKNOWN_ERROR,
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorReply);
        } else {
            await interaction.reply(errorReply);
        }
    }
});

// 消息事件（活跃度追踪）
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    // 使用模块函数处理消息
    await activityTrackerModule.handleMessage(message);
});

// 反应事件（活跃度追踪）
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    // 使用模块函数处理反应
    await activityTrackerModule.handleReactionAdd(reaction, user);
});

// 语音状态更新事件
client.on('voiceStateUpdate', async (oldState, newState) => {
    await activityTrackerModule.handleVoiceStateUpdate(oldState, newState);
});

// ============================================
// 定时任务
// ============================================
function setupCronJobs() {
    // 每小时检查过期验证
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running NFT verification check...');
        await checkExpiredVerifications();
    });

    // 每周一0点重置周活跃度
    cron.schedule('0 0 * * 1', async () => {
        console.log('⏰ Resetting weekly activity...');
        await db.resetWeeklyActivity();
    });

    // 每天发布排行榜（如果配置了频道）
    cron.schedule('0 12 * * *', async () => {
        console.log('⏰ Publishing daily leaderboard...');
        await leaderboardModule.generateAndPostAllLeaderboards();
    });
}

/**
 * 检查过期的NFT验证
 */
async function checkExpiredVerifications() {
    try {
        const expiredUsers = await db.getExpiredVerifications(24);
        console.log(`Checking ${expiredUsers.length} expired verifications`);

        for (const user of expiredUsers) {
            try {
                // 跳过没有明文钱包地址的旧记录（需要用户重新 /verify）
                if (!user.wallet_address) {
                    console.log(`⚠️ Skipping user ${user.user_id}: no wallet_address (legacy hash-only record, needs re-verify)`);
                    continue;
                }

                const result = await checkNFTOwnership(
                    user.wallet_address,
                    user.nft_contract_address,
                    user.required_amount,
                    user.chain || 'ethereum'
                );

                if (!result.success) {
                    // NFT不足，移除角色
                    const guild = await client.guilds.fetch(user.guild_id);
                    const member = await guild.members.fetch(user.user_id).catch(() => null);

                    if (member) {
                        // 移除角色
                        if (user.verified_role_id) {
                            await member.roles.remove(user.verified_role_id).catch(() => { });
                        }
                        // 删除验证记录
                        await db.deleteVerifiedUser(user.guild_id, user.user_id);
                        console.log(`⚠️ Removed verification for ${user.user_id} (NFT insufficient)`);
                    }
                } else {
                    // 更新NFT余额和检查时间
                    await db.upsertVerifiedUser({
                        guildId: user.guild_id,
                        userId: user.user_id,
                        walletAddress: user.wallet_address,
                        nftBalance: result.balance
                    });
                }
            } catch (error) {
                console.error(`Failed to check user ${user.user_id}:`, error.message);
            }

            // 添加延迟避免API限制
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Failed to check expired verifications:', error);
    }
}

// ============================================
// 优雅关闭
// ============================================
process.on('SIGINT', async () => {
    console.log('Shutting down bot...');
    // 记录机器人关闭事件
    securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.BOT_SHUTDOWN, {
        details: { reason: 'SIGINT', shutdownTime: new Date().toISOString() }
    });
    await db.closeDatabase();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down bot...');
    // 记录机器人关闭事件
    securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.BOT_SHUTDOWN, {
        details: { reason: 'SIGTERM', shutdownTime: new Date().toISOString() }
    });
    await db.closeDatabase();
    client.destroy();
    process.exit(0);
});

// ============================================
// 启动机器人
// ============================================
client.login(process.env.DISCORD_TOKEN);
