/**
 * Filename: db.js
 * Purpose: Database operation layer (using sqlite3 async mode)
 *
 * Test Method:
 * 1. Run node index.js
 * 2. Should see "✅ Database initialized"
 * 3. Check if data.db file is generated
 *
 * Change Notes:
 * - Use standard sqlite3 library (async callback mode)
 * - All operations wrapped with Promises
 * - Query syntax using ? placeholders
 * - Wallet address stored using SHA-256 hash
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;

// ==================== Wallet Encryption (AES-256-GCM) ====================
const WALLET_ENC_KEY = process.env.WALLET_ENCRYPTION_KEY || null;
const ENC_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a wallet address using AES-256-GCM
 * @param {string} plaintext - Wallet address
 * @returns {string} Encrypted string in format "enc:iv:ciphertext:tag"
 */
function encryptWallet(plaintext) {
  if (!WALLET_ENC_KEY) return plaintext.toLowerCase();
  const key = crypto.createHash('sha256').update(WALLET_ENC_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext.toLowerCase(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${encrypted}:${tag}`;
}

/**
 * Decrypt a wallet address
 * @param {string} ciphertext - Encrypted string or plaintext address
 * @returns {string|null} Decrypted wallet address
 */
function decryptWallet(ciphertext) {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith('enc:')) return ciphertext;
  if (!WALLET_ENC_KEY) return null;
  try {
    const parts = ciphertext.split(':');
    const iv = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const tag = Buffer.from(parts[3], 'hex');
    const key = crypto.createHash('sha256').update(WALLET_ENC_KEY).digest();
    const decipher = crypto.createDecipheriv(ENC_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Wallet decryption failed:', e.message);
    return null;
  }
}

/**
 * Decrypt wallet_address field on a row object (mutates in place)
 */
function decryptRow(row) {
  if (row && row.wallet_address) {
    row.wallet_address = decryptWallet(row.wallet_address);
  }
  return row;
}

/**
 * Convert wallet address to SHA-256 hash
 * @param {string} walletAddress - Wallet address
 * @returns {string} - SHA-256 hash value
 */
function hashWallet(walletAddress) {
  return crypto
    .createHash('sha256')
    .update(walletAddress.toLowerCase())
    .digest('hex');
}

/**
 * Wrap db.run as Promise
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
 * Wrap db.get as Promise
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
 * Wrap db.all as Promise
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
 * Wrap db.exec as Promise
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
 * Initialize database connection and table structure
 * @param {string} dbPath - Database file path, default ./data.db
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
        // Enable WAL mode for better performance
        await dbRun('PRAGMA journal_mode = WAL');
        await dbRun('PRAGMA busy_timeout = 5000');

        // Read and execute schema.sql
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
          const schema = fs.readFileSync(schemaPath, 'utf8');
          await dbExec(schema);
        }

        // Migration: Add chain column to existing communities table (if not exists)
        try {
          await dbRun(`ALTER TABLE communities ADD COLUMN chain TEXT DEFAULT 'ethereum'`);
          console.log('✅ Migration: Added chain column to communities table');
        } catch (e) {
          // Column already exists, ignore error
          if (!e.message.includes('duplicate column')) {
            console.log('ℹ️ Chain column already exists');
          }
        }

        // Migration: Add wallet_address column to existing verified_users table (plain text, for re-verification)
        try {
          await dbRun(`ALTER TABLE verified_users ADD COLUMN wallet_address TEXT`);
          console.log('✅ Migration: Added wallet_address column to verified_users table');
        } catch (e) {
          // Column already exists, ignore error
        }

        // Migration: Clean up duplicate wallet_address and create unique index (only one user allowed per wallet per guild)
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

        // Simple payment: Create payments table (if not exists)
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

        // Create guilds table (track servers and join order)
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

        // Create subscriptions table (server-level subscription)
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
 * Get database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
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

// ==================== Community Configuration Operations ====================

/**
 * Get community configuration
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<Object|null>} Community configuration object or null
 */
async function getCommunity(guildId) {
  return dbGet('SELECT * FROM communities WHERE guild_id = ?', [guildId]);
}

/**
 * Create or update community configuration (NFT verification related only)
 * @param {Object} data - Configuration data
 * @returns {Promise<Object>} Updated configuration
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
 * Update community configuration (partial update)
 * @param {string} guildId - Discord Guild ID
 * @param {Object} updates - Fields to update
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

// ==================== Activity Settings Operations ====================

/**
 * Get activity settings
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<Object|null>} Activity settings object or null
 */
async function getActivitySettings(guildId) {
  return dbGet('SELECT * FROM activity_settings WHERE guild_id = ?', [guildId]);
}

/**
 * Create or update activity settings
 * @param {Object} data - Configuration data
 * @returns {Promise<Object>} Updated configuration
 */
async function upsertActivitySettings(data) {
  const {
    guildId,
    enabled = 0,
    messageScore = 1.0,
    replyScore = 2.0,
    reactionScore = 0.5,
    voiceScore = 0.1,
    // Daily point cap
    dailyMessageCap = 100,
    dailyReplyCap = 50,
    dailyReactionCap = 50,
    dailyVoiceCap = 120,
    // NFT holding bonus
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
 * Get all guilds with activity tracking enabled
 * @returns {Promise<Array>} Guild list
 */
async function getEnabledActivityGuilds() {
  return dbAll('SELECT * FROM activity_settings WHERE enabled = 1');
}

// ==================== Verified User Operations ====================

/**
 * Get verified user
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @returns {Promise<Object|null>} User object or null
 */
async function getVerifiedUser(guildId, userId) {
  const row = await dbGet('SELECT * FROM verified_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return decryptRow(row);
}

/**
 * Get verified user by wallet address hash
 * @param {string} guildId - Discord Guild ID
 * @param {string} walletAddress - Wallet address (will be automatically converted to hash)
 * @returns {Promise<Object|null>} User object or null
 */
async function getVerifiedUserByWallet(guildId, walletAddress) {
  // Always use wallet_hash for lookups (works regardless of encryption)
  const walletHash = hashWallet(walletAddress);
  const row = await dbGet('SELECT * FROM verified_users WHERE guild_id = ? AND wallet_hash = ?', [guildId, walletHash]);
  return decryptRow(row);
}

/**
 * Create or update verified user
 * @param {Object} data - User data
 * @returns {Promise<Object>} User object
 */
async function upsertVerifiedUser(data) {
  const { guildId, userId, walletAddress, nftBalance } = data;
  const walletHash = hashWallet(walletAddress);
  const walletEncrypted = encryptWallet(walletAddress);

  await dbRun(`
    INSERT INTO verified_users (guild_id, user_id, wallet_address, wallet_hash, nft_balance)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      wallet_address = excluded.wallet_address,
      wallet_hash = excluded.wallet_hash,
      nft_balance = excluded.nft_balance,
      last_checked = CURRENT_TIMESTAMP
  `, [guildId, userId, walletEncrypted, walletHash, nftBalance]);

  return getVerifiedUser(guildId, userId);
}

/**
 * Check if the wallet is already used by another user in the same guild
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Current User ID
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<boolean>} Whether it is used by another user
 */
async function isWalletUsedByOther(guildId, userId, walletAddress) {
  // Use wallet_hash for lookups (works with both encrypted and plaintext storage)
  const walletHash = hashWallet(walletAddress);
  const row = await dbGet(
    'SELECT user_id FROM verified_users WHERE guild_id = ? AND wallet_hash = ? AND user_id != ?',
    [guildId, walletHash, userId]
  );
  return !!row;
}

/**
 * Delete verified user
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @returns {Promise<void>}
 */
async function deleteVerifiedUser(guildId, userId) {
  await dbRun('DELETE FROM verified_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

/**
 * Get all verified users
 * @param {string} guildId - Discord Guild ID
 * @param {number} limit - Max return limit
 * @returns {Promise<Array>} User list
 */
async function getVerifiedUsers(guildId, limit = 100) {
  const rows = await dbAll(`
    SELECT * FROM verified_users
    WHERE guild_id = ?
    ORDER BY verified_at DESC
    LIMIT ?
  `, [guildId, limit]);
  return rows.map(decryptRow);
}

/**
 * Get number of verified users in the guild
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<number>} Number of verified users
 */
async function getVerifiedCount(guildId) {
  const row = await dbGet('SELECT COUNT(*) AS total FROM verified_users WHERE guild_id = ?', [guildId]);
  return row?.total || 0;
}

/**
 * Get users needing re-verification (not checked for specified time)
 * @param {number} intervalMs - Time interval (milliseconds)
 * @returns {Promise<Array>} User list
 */
async function getUsersNeedingReverification(intervalMs) {
  const threshold = new Date(Date.now() - intervalMs).toISOString();
  const rows = await dbAll('SELECT * FROM verified_users WHERE last_checked < ?', [threshold]);
  return rows.map(decryptRow);
}

/**
 * Get users with expired verification (associated with community config)
 * @param {number} hours - Expiry hours
 * @returns {Promise<Array>} User list
 */
async function getExpiredVerifications(hours) {
  const rows = await dbAll(`
    SELECT v.*, c.nft_contract_address, c.chain, c.required_amount, c.verified_role_id
    FROM verified_users v
    JOIN communities c ON v.guild_id = c.guild_id
    WHERE datetime(v.last_checked) < datetime('now', '-' || ? || ' hours')
  `, [hours]);
  return rows.map(decryptRow);
}

/**
 * Update last check time and NFT balance
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @param {number} nftBalance - NFT balance
 * @returns {Promise<void>}
 */
async function updateLastChecked(guildId, userId, nftBalance) {
  await dbRun(`
    UPDATE verified_users
    SET last_checked = CURRENT_TIMESTAMP, nft_balance = ?
    WHERE guild_id = ? AND user_id = ?
  `, [nftBalance, guildId, userId]);
}

// ==================== Activity Tracking Operations ====================

/**
 * Get user activity
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @returns {Promise<Object|null>} Activity data or null
 */
async function getUserActivity(guildId, userId) {
  return dbGet('SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

/**
 * Get leaderboard
 * @param {string} guildId - Discord Guild ID
 * @param {number} limit - Max return limit
 * @param {string} type - Leaderboard type ('total' or 'week')
 * @returns {Promise<Array>} Leaderboard data
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
 * Get user rank
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @returns {Promise<number>} Rank (starting from 1)
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
 * Get total number of tracked users
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<number>} Total number of users
 */
async function getTotalTrackedUsers(guildId) {
  const result = await dbGet('SELECT COUNT(*) as total FROM activity_tracking WHERE guild_id = ?', [guildId]);
  return result?.total || 0;
}

/**
 * Get user's NFT holding bonus multiplier
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @param {Object} settings - Activity settings
 * @returns {Promise<number>} Multiplier
 */
async function getNftMultiplier(guildId, userId, settings) {
  if (!settings.nft_bonus_enabled) return 1.0;

  const verifiedUser = await getVerifiedUser(guildId, userId);
  if (!verifiedUser) return 1.0;

  const nftBalance = verifiedUser.nft_balance || 0;

  // Check each tier (from high to low)
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
 * Get user's daily activity data (reset if it's a new day)
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @returns {Promise<Object>} Today's data
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

  // If it's a new day, reset daily counters
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
 * Batch update activity (with daily caps and NFT bonus)
 * @param {Array} updates - Update array
 * @param {Object} settings - Activity settings
 * @returns {Promise<void>}
 */
async function batchUpdateActivity(updates, settings = null) {
  // Default scores
  const messageScore = settings?.message_score ?? 1;
  const replyScore = settings?.reply_score ?? 2;
  const reactionScore = settings?.reaction_score ?? 0.5;
  const voiceScore = settings?.voice_score ?? 0.1;

  // Daily caps
  const dailyMessageCap = settings?.daily_message_cap ?? 100;
  const dailyReplyCap = settings?.daily_reply_cap ?? 50;
  const dailyReactionCap = settings?.daily_reaction_cap ?? 50;
  const dailyVoiceCap = settings?.daily_voice_cap ?? 120;

  const today = new Date().toISOString().split('T')[0];

  for (const update of updates) {
    const { guildId, userId, message_count = 0, reply_count = 0, reaction_count = 0, voice_minutes = 0 } = update;

    // Get today's activity data
    const dailyData = await getDailyActivity(guildId, userId);

    // Calculate countable amount (consider daily caps)
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

    // If all counts exceed caps, skip
    if (effectiveMessages === 0 && effectiveReplies === 0 && effectiveReactions === 0 && effectiveVoice === 0) {
      continue;
    }

    // Get NFT holding bonus
    const nftMultiplier = settings ? await getNftMultiplier(guildId, userId, settings) : 1.0;

    // Calculate total score (using custom scores and NFT bonus)
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
 * Decrement activity (used when messages are deleted)
 * @param {string} guildId - Discord Guild ID
 * @param {string} userId - Discord User ID
 * @param {string} type - Type ('message' or 'reply')
 * @param {number} value - Amount to decrement
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
 * Reset weekly activity scores
 * @param {string} guildId - Discord Guild ID (optional, reset all if omitted)
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
 * Reset weekly activity (all)
 * @returns {Promise<void>}
 */
async function resetWeeklyActivity() {
  await dbRun('UPDATE activity_tracking SET week_score = 0');
}

/**
 * Get activity data for all users in the guild (supports date range filtering)
 * @param {string} guildId - Discord Guild ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Activity data list
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
 * Get guild activity statistical summary
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<Object>} Statistical summary
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
  // Database Management
  initDatabase,
  getDb,
  closeDatabase,
  hashWallet,

  // Community Configuration (NFT Verification)
  getCommunity,
  upsertCommunity,
  updateCommunity,

  // Activity Settings
  getActivitySettings,
  upsertActivitySettings,
  getEnabledActivityGuilds,

  // Verified User
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

  // Cross-guild Sybil detection
  getWalletGuildCount: async function (walletAddress) {
    const walletHash = hashWallet(walletAddress);
    const row = await dbGet(
      'SELECT COUNT(DISTINCT guild_id) AS total FROM verified_users WHERE wallet_hash = ?',
      [walletHash]
    );
    return row?.total || 0;
  },
  getWalletGuilds: async function (walletAddress) {
    const walletHash = hashWallet(walletAddress);
    return dbAll(
      'SELECT guild_id, user_id, verified_at FROM verified_users WHERE wallet_hash = ?',
      [walletHash]
    );
  },

  // Activity Tracking
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

  // Payment Records (Simple version)
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
        // Transaction already recorded by another request (race condition), return false to prevent duplicate subscription activation
        return false;
      }
      throw e;
    }
  },

  // ===== Guild Tracking =====
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

  // ===== Subscriptions =====
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