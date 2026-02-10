/**
 * 文件名：db.js
 * 用途：数据库操作层（使用 sqlite3 异步模式）
 *
 * 测试方法：
 * 1. 运行 node index.js
 * 2. 应该看到 "✅ Database initialized"
 * 3. 检查是否生成 data.db 文件
 *
 * 改动说明：
 * - 使用标准 sqlite3 库（异步回调模式）
 * - 所有操作使用 Promise 包装
 * - 查询语法使用 ? 占位符
 * - 钱包地址使用 SHA-256 哈希存储
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;

/**
 * 将钱包地址转换为SHA-256哈希
 * @param {string} walletAddress - 钱包地址
 * @returns {string} - SHA-256哈希值
 */
function hashWallet(walletAddress) {
  return crypto
    .createHash('sha256')
    .update(walletAddress.toLowerCase())
    .digest('hex');
}

/**
 * 包装 db.run 为 Promise
 */
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * 包装 db.get 为 Promise
 */
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * 包装 db.all 为 Promise
 */
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 包装 db.exec 为 Promise
 */
function dbExec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * 初始化数据库连接和表结构
 * @param {string} dbPath - 数据库文件路径，默认 ./data.db
 * @returns {Promise<void>}
 */
async function initDatabase(dbPath = process.env.DATABASE_PATH || './data.db') {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        console.error('❌ Database connection failed:', err.message);
        reject(err);
        return;
      }

      try {
        // 启用 WAL 模式以提高性能
        await dbRun('PRAGMA journal_mode = WAL');
        await dbRun('PRAGMA busy_timeout = 5000');

        // 读取并执行 schema.sql
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
          const schema = fs.readFileSync(schemaPath, 'utf8');
          await dbExec(schema);
        }

        // 迁移：为现有 communities 表添加 chain 列（如果不存在）
        try {
          await dbRun(`ALTER TABLE communities ADD COLUMN chain TEXT DEFAULT 'ethereum'`);
          console.log('✅ Migration: Added chain column to communities table');
        } catch (e) {
          // 列已存在，忽略错误
          if (!e.message.includes('duplicate column')) {
            console.log('ℹ️ Chain column already exists');
          }
        }

        // 迁移：为现有 verified_users 表添加 wallet_address 列（明文，用于重新验证）
        try {
          await dbRun(`ALTER TABLE verified_users ADD COLUMN wallet_address TEXT`);
          console.log('✅ Migration: Added wallet_address column to verified_users table');
        } catch (e) {
          // 列已存在，忽略错误
        }

        // 迁移：清理重复的 wallet_address 并创建唯一索引（同一服务器同一钱包只允许一个用户）
        try {
          await dbRun(`
            UPDATE verified_users SET wallet_address = NULL
            WHERE wallet_address IS NOT NULL AND id NOT IN (
              SELECT MIN(id) FROM verified_users
              WHERE wallet_address IS NOT NULL
              GROUP BY guild_id, wallet_address
            )
          `);
          await dbRun(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_users_guild_wallet_unique
            ON verified_users(guild_id, wallet_address)
            WHERE wallet_address IS NOT NULL
          `);
        } catch (e) {
          if (!e.message.includes('already exists')) {
            console.warn('⚠️ Wallet uniqueness migration:', e.message);
          }
        }

        // 简易支付：创建 payments 表（如果不存在）
        try {
          await dbRun(`
            CREATE TABLE IF NOT EXISTS payments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              guild_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              chain TEXT NOT NULL,
              tx_hash TEXT NOT NULL UNIQUE,
              token_contract TEXT NOT NULL,
              receiver TEXT NOT NULL,
              payer TEXT,
              amount_raw TEXT NOT NULL,
              amount_decimals INTEGER DEFAULT 6,
              status TEXT DEFAULT 'verified',
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              verified_at TEXT
            )
          `);
        } catch (e) {
          console.error('❌ Failed to ensure payments table:', e.message);
        }

        // 创建 guilds 表（跟踪服务器与加入顺序）
        try {
          await dbRun(`
            CREATE TABLE IF NOT EXISTS guilds (
              guild_id TEXT PRIMARY KEY,
              name TEXT,
              join_order INTEGER,
              joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
              left_at TEXT
            )
          `);
        } catch (e) {
          console.error('❌ Failed to ensure guilds table:', e.message);
        }

        // 创建 subscriptions 表（服务器级订阅）
        try {
          await dbRun(`
            CREATE TABLE IF NOT EXISTS subscriptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              guild_id TEXT NOT NULL,
              payer_user_id TEXT,
              chain TEXT,
              tx_hash TEXT,
              amount_raw TEXT,
              amount_decimals INTEGER DEFAULT 6,
              status TEXT DEFAULT 'active', -- active | expired | canceled
              start_at TEXT NOT NULL,
              end_at TEXT NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
              UNIQUE (guild_id, tx_hash)
            )
          `);
        } catch (e) {
          console.error('❌ Failed to ensure subscriptions table:', e.message);
        }

        console.log('✅ Database initialized:', dbPath);
        resolve();
      } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        reject(error);
      }
    });
  });
}

/**
 * 获取数据库实例
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * 关闭数据库连接
 * @returns {Promise<void>}
 */
function closeDatabase() {
  return new Promise((resolve) => {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err.message);
        } else {
          console.log('✅ Database connection closed');
        }
        db = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ==================== 社区配置操作 ====================

/**
 * 获取社区配置
 * @param {string} guildId - Discord 服务器 ID
 * @returns {Promise<Object|null>} 社区配置对象或 null
 */
async function getCommunity(guildId) {
  return dbGet('SELECT * FROM communities WHERE guild_id = ?', [guildId]);
}

/**
 * 创建或更新社区配置（仅NFT验证相关）
 * @param {Object} data - 配置数据
 * @returns {Promise<Object>} 更新后的配置
 */
async function upsertCommunity(data) {
  const {
    guildId,
    nftContractAddress,
    chain = 'ethereum',
    requiredAmount = 1,
    verifiedRoleId,
    kickDelayHours = 24
  } = data;

  await dbRun(`
    INSERT INTO communities (guild_id, nft_contract_address, chain, required_amount,
      verified_role_id, kick_delay_hours)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      nft_contract_address = COALESCE(excluded.nft_contract_address, nft_contract_address),
      chain = COALESCE(excluded.chain, chain),
      required_amount = COALESCE(excluded.required_amount, required_amount),
      verified_role_id = COALESCE(excluded.verified_role_id, verified_role_id),
      kick_delay_hours = COALESCE(excluded.kick_delay_hours, kick_delay_hours),
      updated_at = CURRENT_TIMESTAMP
  `, [
    guildId,
    nftContractAddress || null,
    chain,
    requiredAmount,
    verifiedRoleId || null,
    kickDelayHours
  ]);

  return getCommunity(guildId);
}

/**
 * 更新社区配置（部分更新）
 * @param {string} guildId - Discord 服务器 ID
 * @param {Object} updates - 要更新的字段
 * @returns {Promise<Object|null>}
 */
async function updateCommunity(guildId, updates) {
  const fields = [];
  const values = [];

  const allowedFields = [
    'nft_contract_address', 'chain', 'required_amount', 'verified_role_id', 'kick_delay_hours'
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(guildId);

  await dbRun(`UPDATE communities SET ${fields.join(', ')} WHERE guild_id = ?`, values);
  return getCommunity(guildId);
}

// ==================== 活跃度设置操作 ====================

/**
 * 获取活跃度设置
 * @param {string} guildId - Discord 服务器 ID
 * @returns {Promise<Object|null>} 活跃度设置对象或 null
 */
async function getActivitySettings(guildId) {
  return dbGet('SELECT * FROM activity_settings WHERE guild_id = ?', [guildId]);
}

/**
 * 创建或更新活跃度设置
 * @param {Object} data - 配置数据
 * @returns {Promise<Object>} 更新后的配置
 */
async function upsertActivitySettings(data) {
  const {
    guildId,
    enabled = 0,
    messageScore = 1.0,
    replyScore = 2.0,
    reactionScore = 0.5,
    voiceScore = 0.1,
    // 每日积分上限
    dailyMessageCap = 100,
    dailyReplyCap = 50,
    dailyReactionCap = 50,
    dailyVoiceCap = 120,
    // NFT持有量加成
    nftBonusEnabled = 0,
    nftTier1Count = 1,
    nftTier1Multiplier = 1.0,
    nftTier2Count = 3,
    nftTier2Multiplier = 1.2,
    nftTier3Count = 5,
    nftTier3Multiplier = 1.5,
    trackingChannels = null,
    leaderboardChannelId = null
  } = data;

  await dbRun(`
    INSERT INTO activity_settings (guild_id, enabled, message_score, reply_score,
      reaction_score, voice_score, daily_message_cap, daily_reply_cap,
      daily_reaction_cap, daily_voice_cap, nft_bonus_enabled,
      nft_tier1_count, nft_tier1_multiplier, nft_tier2_count, nft_tier2_multiplier,
      nft_tier3_count, nft_tier3_multiplier, tracking_channels, leaderboard_channel_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = excluded.enabled,
      message_score = excluded.message_score,
      reply_score = excluded.reply_score,
      reaction_score = excluded.reaction_score,
      voice_score = excluded.voice_score,
      daily_message_cap = excluded.daily_message_cap,
      daily_reply_cap = excluded.daily_reply_cap,
      daily_reaction_cap = excluded.daily_reaction_cap,
      daily_voice_cap = excluded.daily_voice_cap,
      nft_bonus_enabled = excluded.nft_bonus_enabled,
      nft_tier1_count = excluded.nft_tier1_count,
      nft_tier1_multiplier = excluded.nft_tier1_multiplier,
      nft_tier2_count = excluded.nft_tier2_count,
      nft_tier2_multiplier = excluded.nft_tier2_multiplier,
      nft_tier3_count = excluded.nft_tier3_count,
      nft_tier3_multiplier = excluded.nft_tier3_multiplier,
      tracking_channels = excluded.tracking_channels,
      leaderboard_channel_id = excluded.leaderboard_channel_id,
      updated_at = CURRENT_TIMESTAMP
  `, [
    guildId,
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
    nftTier1Count,
    nftTier1Multiplier,
    nftTier2Count,
    nftTier2Multiplier,
    nftTier3Count,
    nftTier3Multiplier,
    trackingChannels,
    leaderboardChannelId
  ]);

  return getActivitySettings(guildId);
}

/**
 * 获取所有启用活跃度追踪的服务器
 * @returns {Promise<Array>} 服务器列表
 */
async function getEnabledActivityGuilds() {
  return dbAll('SELECT * FROM activity_settings WHERE enabled = 1');
}

// ==================== 已验证用户操作 ====================

/**
 * 获取已验证用户
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @returns {Promise<Object|null>} 用户对象或 null
 */
async function getVerifiedUser(guildId, userId) {
  return dbGet('SELECT * FROM verified_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

/**
 * 根据钱包地址哈希获取已验证用户
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} walletAddress - 钱包地址（将自动转换为哈希）
 * @returns {Promise<Object|null>} 用户对象或 null
 */
async function getVerifiedUserByWallet(guildId, walletAddress) {
  const walletLower = walletAddress.toLowerCase();
  const row = await dbGet('SELECT * FROM verified_users WHERE guild_id = ? AND wallet_address = ?', [guildId, walletLower]);
  if (row) return row;
  // 兼容旧数据：回退到 wallet_hash 查询
  const walletHash = hashWallet(walletAddress);
  return dbGet('SELECT * FROM verified_users WHERE guild_id = ? AND wallet_hash = ?', [guildId, walletHash]);
}

/**
 * 创建或更新已验证用户
 * @param {Object} data - 用户数据
 * @returns {Promise<Object>} 用户对象
 */
async function upsertVerifiedUser(data) {
  const { guildId, userId, walletAddress, nftBalance } = data;
  const walletHash = hashWallet(walletAddress);
  const walletLower = walletAddress.toLowerCase();

  await dbRun(`
    INSERT INTO verified_users (guild_id, user_id, wallet_address, wallet_hash, nft_balance)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      wallet_address = excluded.wallet_address,
      wallet_hash = excluded.wallet_hash,
      nft_balance = excluded.nft_balance,
      last_checked = CURRENT_TIMESTAMP
  `, [guildId, userId, walletLower, walletHash, nftBalance]);

  return getVerifiedUser(guildId, userId);
}

/**
 * 检查钱包是否已被同一服务器的其他用户使用
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - 当前用户 ID
 * @param {string} walletAddress - 钱包地址
 * @returns {Promise<boolean>} 是否已被其他用户使用
 */
async function isWalletUsedByOther(guildId, userId, walletAddress) {
  const walletLower = walletAddress.toLowerCase();
  const row = await dbGet(
    'SELECT user_id FROM verified_users WHERE guild_id = ? AND wallet_address = ? AND user_id != ?',
    [guildId, walletLower, userId]
  );
  if (row) return true;
  // 兼容旧数据：检查无 wallet_address 的 wallet_hash 记录
  const walletHash = hashWallet(walletAddress);
  const hashRow = await dbGet(
    'SELECT user_id FROM verified_users WHERE guild_id = ? AND wallet_hash = ? AND wallet_address IS NULL AND user_id != ?',
    [guildId, walletHash, userId]
  );
  return !!hashRow;
}

/**
 * 删除已验证用户
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @returns {Promise<void>}
 */
async function deleteVerifiedUser(guildId, userId) {
  await dbRun('DELETE FROM verified_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

/**
 * 获取所有已验证用户
 * @param {string} guildId - Discord 服务器 ID
 * @param {number} limit - 最大返回数量
 * @returns {Promise<Array>} 用户列表
 */
async function getVerifiedUsers(guildId, limit = 100) {
  return dbAll(`
    SELECT * FROM verified_users
    WHERE guild_id = ?
    ORDER BY verified_at DESC
    LIMIT ?
  `, [guildId, limit]);
}

/**
 * 获取服务器已验证用户数量
 * @param {string} guildId - Discord 服务器 ID
 * @returns {Promise<number>} 已验证用户数
 */
async function getVerifiedCount(guildId) {
  const row = await dbGet('SELECT COUNT(*) AS total FROM verified_users WHERE guild_id = ?', [guildId]);
  return row?.total || 0;
}

/**
 * 获取需要重新验证的用户（超过指定时间未检查）
 * @param {number} intervalMs - 时间间隔（毫秒）
 * @returns {Promise<Array>} 用户列表
 */
async function getUsersNeedingReverification(intervalMs) {
  const threshold = new Date(Date.now() - intervalMs).toISOString();
  return dbAll('SELECT * FROM verified_users WHERE last_checked < ?', [threshold]);
}

/**
 * 获取过期验证的用户（关联社区配置）
 * @param {number} hours - 过期小时数
 * @returns {Promise<Array>} 用户列表
 */
async function getExpiredVerifications(hours) {
  return dbAll(`
    SELECT v.*, c.nft_contract_address, c.chain, c.required_amount, c.verified_role_id
    FROM verified_users v
    JOIN communities c ON v.guild_id = c.guild_id
    WHERE datetime(v.last_checked) < datetime('now', '-' || ? || ' hours')
  `, [hours]);
}

/**
 * 更新最后检查时间和NFT余额
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @param {number} nftBalance - NFT 持有数量
 * @returns {Promise<void>}
 */
async function updateLastChecked(guildId, userId, nftBalance) {
  await dbRun(`
    UPDATE verified_users
    SET last_checked = CURRENT_TIMESTAMP, nft_balance = ?
    WHERE guild_id = ? AND user_id = ?
  `, [nftBalance, guildId, userId]);
}

// ==================== 活跃度追踪操作 ====================

/**
 * 获取用户活跃度
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @returns {Promise<Object|null>} 活跃度数据或 null
 */
async function getUserActivity(guildId, userId) {
  return dbGet('SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

/**
 * 获取排行榜
 * @param {string} guildId - Discord 服务器 ID
 * @param {number} limit - 最大返回数量
 * @param {string} type - 排行榜类型 ('total' 或 'week')
 * @returns {Promise<Array>} 排行榜数据
 */
async function getLeaderboard(guildId, limit = 10, type = 'total') {
  const scoreField = type === 'week' ? 'week_score' : 'total_score';
  return dbAll(`
    SELECT * FROM activity_tracking
    WHERE guild_id = ? AND ${scoreField} > 0
    ORDER BY ${scoreField} DESC
    LIMIT ?
  `, [guildId, limit]);
}

/**
 * 获取用户排名
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @returns {Promise<number>} 排名（从1开始）
 */
async function getUserRank(guildId, userId) {
  const userActivity = await getUserActivity(guildId, userId);
  if (!userActivity) return 0;

  const result = await dbGet(`
    SELECT COUNT(*) + 1 as rank FROM activity_tracking
    WHERE guild_id = ? AND total_score > ?
  `, [guildId, userActivity.total_score || 0]);

  return result?.rank || 0;
}

/**
 * 获取追踪的用户总数
 * @param {string} guildId - Discord 服务器 ID
 * @returns {Promise<number>} 用户总数
 */
async function getTotalTrackedUsers(guildId) {
  const result = await dbGet('SELECT COUNT(*) as total FROM activity_tracking WHERE guild_id = ?', [guildId]);
  return result?.total || 0;
}

/**
 * 获取用户的NFT持有量加成倍率
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @param {Object} settings - 活跃度设置
 * @returns {Promise<number>} 倍率
 */
async function getNftMultiplier(guildId, userId, settings) {
  if (!settings.nft_bonus_enabled) return 1.0;

  const verifiedUser = await getVerifiedUser(guildId, userId);
  if (!verifiedUser) return 1.0;

  const nftBalance = verifiedUser.nft_balance || 0;

  // 检查各档位（从高到低）
  if (nftBalance >= settings.nft_tier3_count) {
    return settings.nft_tier3_multiplier || 1.5;
  } else if (nftBalance >= settings.nft_tier2_count) {
    return settings.nft_tier2_multiplier || 1.2;
  } else if (nftBalance >= settings.nft_tier1_count) {
    return settings.nft_tier1_multiplier || 1.0;
  }

  return 1.0;
}

/**
 * 获取用户今日活跃度数据（如果是新的一天则重置）
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @returns {Promise<Object>} 今日数据
 */
async function getDailyActivity(guildId, userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const activity = await dbGet(
    'SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!activity) {
    return {
      daily_messages: 0,
      daily_replies: 0,
      daily_reactions: 0,
      daily_voice: 0,
      daily_reset_date: today
    };
  }

  // 如果是新的一天，重置每日计数器
  if (activity.daily_reset_date !== today) {
    await dbRun(`
      UPDATE activity_tracking SET
        daily_messages = 0,
        daily_replies = 0,
        daily_reactions = 0,
        daily_voice = 0,
        daily_reset_date = ?
      WHERE guild_id = ? AND user_id = ?
    `, [today, guildId, userId]);

    return {
      daily_messages: 0,
      daily_replies: 0,
      daily_reactions: 0,
      daily_voice: 0,
      daily_reset_date: today
    };
  }

  return activity;
}

/**
 * 批量更新活跃度（带每日上限和NFT加成）
 * @param {Array} updates - 更新数组
 * @param {Object} settings - 活跃度设置
 * @returns {Promise<void>}
 */
async function batchUpdateActivity(updates, settings = null) {
  // 默认分数
  const messageScore = settings?.message_score ?? 1;
  const replyScore = settings?.reply_score ?? 2;
  const reactionScore = settings?.reaction_score ?? 0.5;
  const voiceScore = settings?.voice_score ?? 0.1;

  // 每日上限
  const dailyMessageCap = settings?.daily_message_cap ?? 100;
  const dailyReplyCap = settings?.daily_reply_cap ?? 50;
  const dailyReactionCap = settings?.daily_reaction_cap ?? 50;
  const dailyVoiceCap = settings?.daily_voice_cap ?? 120;

  const today = new Date().toISOString().split('T')[0];

  for (const update of updates) {
    const { guildId, userId, message_count = 0, reply_count = 0, reaction_count = 0, voice_minutes = 0 } = update;

    // 获取今日活跃度数据
    const dailyData = await getDailyActivity(guildId, userId);

    // 计算可计分的数量（考虑每日上限）
    const effectiveMessages = Math.min(
      message_count,
      Math.max(0, dailyMessageCap - dailyData.daily_messages)
    );
    const effectiveReplies = Math.min(
      reply_count,
      Math.max(0, dailyReplyCap - dailyData.daily_replies)
    );
    const effectiveReactions = Math.min(
      reaction_count,
      Math.max(0, dailyReactionCap - dailyData.daily_reactions)
    );
    const effectiveVoice = Math.min(
      voice_minutes,
      Math.max(0, dailyVoiceCap - dailyData.daily_voice)
    );

    // 如果所有计数都超过上限，跳过
    if (effectiveMessages === 0 && effectiveReplies === 0 && effectiveReactions === 0 && effectiveVoice === 0) {
      continue;
    }

    // 获取NFT持有量加成
    const nftMultiplier = settings ? await getNftMultiplier(guildId, userId, settings) : 1.0;

    // 计算总分（使用自定义分数和NFT加成）
    const baseScore =
      effectiveMessages * messageScore +
      effectiveReplies * replyScore +
      effectiveReactions * reactionScore +
      effectiveVoice * voiceScore;

    const totalScore = Math.round(baseScore * nftMultiplier * 100) / 100;

    await dbRun(`
      INSERT INTO activity_tracking (guild_id, user_id, message_count, reply_count, reaction_count, voice_minutes,
        total_score, week_score, daily_messages, daily_replies, daily_reactions, daily_voice, daily_reset_date, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        message_count = activity_tracking.message_count + ?,
        reply_count = activity_tracking.reply_count + ?,
        reaction_count = activity_tracking.reaction_count + ?,
        voice_minutes = activity_tracking.voice_minutes + ?,
        total_score = activity_tracking.total_score + ?,
        week_score = activity_tracking.week_score + ?,
        daily_messages = CASE WHEN activity_tracking.daily_reset_date = ? THEN activity_tracking.daily_messages + ? ELSE ? END,
        daily_replies = CASE WHEN activity_tracking.daily_reset_date = ? THEN activity_tracking.daily_replies + ? ELSE ? END,
        daily_reactions = CASE WHEN activity_tracking.daily_reset_date = ? THEN activity_tracking.daily_reactions + ? ELSE ? END,
        daily_voice = CASE WHEN activity_tracking.daily_reset_date = ? THEN activity_tracking.daily_voice + ? ELSE ? END,
        daily_reset_date = ?,
        last_active = CURRENT_TIMESTAMP
    `, [
      guildId, userId, effectiveMessages, effectiveReplies, effectiveReactions, effectiveVoice,
      totalScore, totalScore, effectiveMessages, effectiveReplies, effectiveReactions, effectiveVoice, today,
      // UPDATE SET values
      effectiveMessages, effectiveReplies, effectiveReactions, effectiveVoice, totalScore, totalScore,
      today, effectiveMessages, effectiveMessages,
      today, effectiveReplies, effectiveReplies,
      today, effectiveReactions, effectiveReactions,
      today, effectiveVoice, effectiveVoice,
      today
    ]);
  }
}

/**
 * 减少活跃度（用于消息删除时）
 * @param {string} guildId - Discord 服务器 ID
 * @param {string} userId - Discord 用户 ID
 * @param {string} type - 类型 ('message' 或 'reply')
 * @param {number} value - 减少的数量
 * @returns {Promise<void>}
 */
async function decrementActivity(guildId, userId, type, value = 1) {
  const column = type === 'message' ? 'message_count' : type === 'reply' ? 'reply_count' : null;
  if (!column) return;

  const scoreDeduction = type === 'message' ? value : value * 2;

  await dbRun(`
    UPDATE activity_tracking SET
      ${column} = MAX(0, ${column} - ?),
      total_score = MAX(0, total_score - ?),
      week_score = MAX(0, week_score - ?)
    WHERE guild_id = ? AND user_id = ?
  `, [value, scoreDeduction, scoreDeduction, guildId, userId]);
}

/**
 * 重置周活跃度分数
 * @param {string} guildId - Discord 服务器 ID（可选，不传则重置所有）
 * @returns {Promise<void>}
 */
async function resetWeeklyScores(guildId = null) {
  if (guildId) {
    await dbRun('UPDATE activity_tracking SET week_score = 0 WHERE guild_id = ?', [guildId]);
  } else {
    await dbRun('UPDATE activity_tracking SET week_score = 0');
  }
}

/**
 * 重置周活跃度��全部）
 * @returns {Promise<void>}
 */
async function resetWeeklyActivity() {
  await dbRun('UPDATE activity_tracking SET week_score = 0');
}

/**
 * 获取服务器所有用户的活跃度数据（支持时间范围过滤）
 * @param {string} guildId - Discord 服务器 ID
 * @param {Object} options - 查询选项
 * @returns {Promise<Array>} 活跃度数据列表
 */
async function getAllActivityData(guildId, options = {}) {
  const {
    limit = 50,
    offset = 0,
    startDate = null,
    endDate = null,
    sortBy = 'total_score',
    sortOrder = 'DESC'
  } = options;

  const allowedSortFields = ['total_score', 'week_score', 'message_count', 'reply_count', 'reaction_count', 'voice_minutes', 'last_active'];
  const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'total_score';
  const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

  let sql = `SELECT * FROM activity_tracking WHERE guild_id = ?`;
  const params = [guildId];

  if (startDate) {
    sql += ` AND last_active >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND last_active <= ?`;
    params.push(endDate + ' 23:59:59');
  }

  sql += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return dbAll(sql, params);
}

/**
 * 获取服务器活跃度统计摘要
 * @param {string} guildId - Discord 服务器 ID
 * @returns {Promise<Object>} 统计摘要
 */
async function getActivitySummary(guildId) {
  const result = await dbGet(`
    SELECT
      COUNT(*) as total_users,
      SUM(message_count) as total_messages,
      SUM(reply_count) as total_replies,
      SUM(reaction_count) as total_reactions,
      SUM(voice_minutes) as total_voice_minutes,
      AVG(total_score) as avg_score,
      MAX(total_score) as max_score
    FROM activity_tracking
    WHERE guild_id = ?
  `, [guildId]);
  return result;
}

module.exports = {
  // 数据库管理
  initDatabase,
  getDb,
  closeDatabase,
  hashWallet,

  // 社区配置（NFT验证）
  getCommunity,
  upsertCommunity,
  updateCommunity,

  // 活跃度设置
  getActivitySettings,
  upsertActivitySettings,
  getEnabledActivityGuilds,

  // 已验证用户
  getVerifiedUser,
  getVerifiedUserByWallet,
  upsertVerifiedUser,
  isWalletUsedByOther,
  deleteVerifiedUser,
  getVerifiedUsers,
  getVerifiedCount,
  getUsersNeedingReverification,
  getExpiredVerifications,
  updateLastChecked,

  // 活跃度追踪
  getUserActivity,
  getLeaderboard,
  getUserRank,
  getTotalTrackedUsers,
  batchUpdateActivity,
  decrementActivity,
  resetWeeklyScores,
  resetWeeklyActivity,
  getAllActivityData,
  getActivitySummary,
  getNftMultiplier,
  getDailyActivity,

  // 支付记录（简版）
  getPaymentByTx: async function (txHash) {
    return dbGet('SELECT * FROM payments WHERE tx_hash = ?', [txHash.toLowerCase()]);
  },
  recordPayment: async function ({ guildId, userId, chain, txHash, tokenContract, receiver, payer, amountRaw, amountDecimals = 6, status = 'verified' }) {
    try {
      await dbRun(`
        INSERT INTO payments (guild_id, user_id, chain, tx_hash, token_contract, receiver, payer, amount_raw, amount_decimals, status, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        guildId, userId, chain, txHash.toLowerCase(), tokenContract.toLowerCase(), receiver.toLowerCase(),
        payer ? payer.toLowerCase() : null, String(amountRaw), amountDecimals, status
      ]);
      return true;
    } catch (e) {
      if (e && e.message && e.message.includes('UNIQUE')) {
        // 交易已被其他请求记录（竞态条件），返回 false 阻止重复激活订阅
        return false;
      }
      throw e;
    }
  },

  // ===== 服务器（Guild）追踪 =====
  addGuildIfNotExists: async function (guildId, name = null) {
    const existing = await dbGet('SELECT * FROM guilds WHERE guild_id = ?', [guildId]);
    if (existing) {
      await dbRun('UPDATE guilds SET name = COALESCE(?, name), left_at = NULL WHERE guild_id = ?', [name, guildId]);
      return { guild_id: guildId, join_order: existing.join_order };
    }
    const row = await dbGet('SELECT MAX(join_order) AS max_order FROM guilds');
    const nextOrder = (row?.max_order || 0) + 1;
    await dbRun('INSERT INTO guilds (guild_id, name, join_order) VALUES (?, ?, ?)', [guildId, name, nextOrder]);
    return { guild_id: guildId, join_order: nextOrder };
  },
  markGuildLeft: async function (guildId) {
    await dbRun('UPDATE guilds SET left_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [guildId]);
  },
  getGuildCount: async function () {
    const row = await dbGet('SELECT COUNT(*) AS total FROM guilds WHERE left_at IS NULL');
    return row?.total || 0;
  },
  isFoundingGuild: async function (guildId, foundingLimit = 50) {
    const row = await dbGet('SELECT join_order FROM guilds WHERE guild_id = ?', [guildId]);
    if (!row) return false;
    return (row.join_order || 0) > 0 && row.join_order <= foundingLimit;
  },

  // ===== 订阅（Subscriptions） =====
  isGuildSubscribed: async function (guildId, graceDays = 0) {
    const row = await dbGet(
      `SELECT COUNT(*) AS c FROM subscriptions
       WHERE guild_id = ? AND status = 'active'
         AND datetime(end_at) >= datetime('now', ?)` ,
      [guildId, graceDays ? `-${graceDays} days` : '0 days']
    );
    return (row?.c || 0) > 0;
  },
  createOrExtendSubscription: async function ({ guildId, payerUserId = null, chain = null, txHash = null, amountRaw = null, amountDecimals = 6, durationDays = 30 }) {
    const now = new Date();
    const latest = await dbGet(
      `SELECT end_at FROM subscriptions
       WHERE guild_id = ? AND status = 'active'
       ORDER BY datetime(end_at) DESC LIMIT 1`,
      [guildId]
    );
    const base = latest && latest.end_at && new Date(latest.end_at) > now ? new Date(latest.end_at) : now;
    const end = new Date(base.getTime() + durationDays * 86400000);
    const startAt = base.toISOString();
    const endAt = end.toISOString();
    await dbRun(
      `INSERT INTO subscriptions (guild_id, payer_user_id, chain, tx_hash, amount_raw, amount_decimals, status, start_at, end_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [guildId, payerUserId, chain, txHash, amountRaw != null ? String(amountRaw) : null, amountDecimals, startAt, endAt]
    );
    return { startAt, endAt };
  },
  countActiveSubscriptions: async function (graceDays = 0) {
    const row = await dbGet(
      `SELECT COUNT(DISTINCT guild_id) AS total
       FROM subscriptions
       WHERE status = 'active' AND datetime(end_at) >= datetime('now', ?)` ,
      [graceDays ? `-${graceDays} days` : '0 days']
    );
    return row?.total || 0;
  },
  getBotStats: async function (foundingLimit = 50, graceDays = 0) {
    const totalGuildsRow = await dbGet('SELECT COUNT(*) AS total FROM guilds WHERE left_at IS NULL');
    const foundingRow = await dbGet('SELECT COUNT(*) AS total FROM guilds WHERE left_at IS NULL AND join_order <= ?', [foundingLimit]);
    const activeSubs = await this.countActiveSubscriptions(graceDays);
    return {
      totalGuilds: totalGuildsRow?.total || 0,
      foundingCount: foundingRow?.total || 0,
      activeSubscriptions: activeSubs
    };
  },
};
