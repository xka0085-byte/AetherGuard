/**
 * Filename: activityTracker.js
 * Purpose: Activity tracking module (simplified version - no Redis)
 *
 * Test Method:
 * 1. Start bot
 * 2. Send messages in a configured guild
 * 3. Run /my-activity should show points
 *
 * Change Notes:
 * - Removed Redis queue support (uses memory queue only)
 * - Removed flagUser function (no longer need anti-abuse)
 * - Simplified isTrackingEnabled check
 * - Simplified from 407 lines to ~250 lines
 */

const config = require('../config');
const db = require('../database/db');
const securityLogger = require('../utils/securityLogger');

// Discord client reference (set via initActivityTracker)
let discordClient = null;

// Memory queue for activity events
let activityQueue = [];

// Track recent messages for cooldown (userId -> timestamp)
const recentMessages = new Map();

// Track message count for spam detection (userId -> { count, windowStart })
const spamTracker = new Map();

// Track voice session start time (guildId_userId -> { joinTime, muted, deafened })
const voiceSessions = new Map();

// ========== Feature 2: Duplicate Message Detection ==========
// Track user's last 10 messages (userId -> Array<string>)
const userMessageHistory = new Map();
const MESSAGE_HISTORY_SIZE = 10;
const SIMILARITY_THRESHOLD = 0.7; // Similarity threshold (70% — stricter with Levenshtein)

// ========== Anti-Farming: Reaction Pattern Tracking ==========
// Track reaction counts per user per window (userId -> { count, windowStart, uniqueMessages })
const reactionTracker = new Map();
const REACTION_WINDOW_MS = 300000; // 5-minute window
const REACTION_MAX_PER_WINDOW = 30; // Max 30 reactions per 5 minutes
const REACTION_UNIQUE_RATIO = 0.3; // At least 30% unique messages

// ========== Anti-Farming: Activity Anomaly Detection ==========
// Track daily activity baseline (userId -> { history: [{ date, score }], avgScore })
const activityBaseline = new Map();
const ANOMALY_MULTIPLIER = 5; // Flag if daily score > 5x average
const BASELINE_DAYS = 7; // Track last 7 days for baseline

/**
 * Initialize activity tracker
 * @param {Client} client - Discord client instance
 */
function initActivityTracker(client = null) {
  discordClient = client;

  // Start batch processing timer
  setInterval(processBatch, config.activity.queue.processInterval);

  // Start cleanup timer (clean up expired data every hour)
  setInterval(cleanupTrackingData, 3600000);

  // Start periodic voice scoring (every 5 minutes)
  setInterval(processVoiceSessions, 300000);

  console.log(`✅ Activity tracker initialized (batch interval: ${config.activity.queue.processInterval}ms, voice checkpoint: 5min)`);
}

/**
 * Check if activity tracking is enabled for the guild
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} Returns activity settings or null
 */
async function getActivitySettingsIfEnabled(guildId) {
  if (!config.activity.enabled) return null;

  const settings = await db.getActivitySettings(guildId);
  if (!settings || !settings.enabled) return null;

  return settings;
}

/**
 * Check if the channel is within the tracking scope
 * @param {string} guildId - Guild ID
 * @param {string} channelId - Channel ID
 * @param {Object} settings - Activity settings
 * @returns {boolean}
 */
function isChannelTracked(channelId, settings) {
  if (!settings.tracking_channels) return true; // If not set, track all channels

  try {
    const trackedChannels = JSON.parse(settings.tracking_channels);
    return trackedChannels.includes(channelId);
  } catch {
    return true; // If parsing fails, track all channels
  }
}

/**
 * Record activity event
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} type - Event type: 'message', 'reply', 'reaction', 'voice'
 * @param {number} value - Value (default: 1)
 */
function trackActivity(guildId, userId, type, value = 1) {
  activityQueue.push({
    guildId,
    userId,
    type,
    value,
    timestamp: Date.now(),
  });
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - String 1
 * @param {string} b - String 2
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Calculate similarity between two strings
 * Uses Levenshtein distance for short messages, Jaccard for longer ones
 * @param {string} str1 - String 1
 * @param {string} str2 - String 2
 * @returns {number} Similarity (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  // For short messages (< 50 chars), use Levenshtein distance
  // This catches "Hello 1" vs "Hello 2" style evasion
  if (s1.length < 50 || s2.length < 50) {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;
    const dist = levenshteinDistance(s1, s2);
    return 1 - (dist / maxLen);
  }

  // For longer messages, use Jaccard similarity (more efficient)
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Check if the message is a duplicate of recent messages
 * @param {string} userId - User ID
 * @param {string} content - Message content
 * @returns {boolean} Whether it's a duplicate
 */
function isDuplicateMessage(userId, content) {
  if (!content || content.length < 5) return false;

  const history = userMessageHistory.get(userId) || [];

  // Check if similar to recent messages
  for (const prevMsg of history) {
    const similarity = calculateSimilarity(content, prevMsg);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return true; // Duplicate message
    }
  }

  // Add to history
  history.push(content);
  if (history.length > MESSAGE_HISTORY_SIZE) {
    history.shift(); // Keep the last 10
  }
  userMessageHistory.set(userId, history);

  return false;
}

/**
 * Detect gibberish/low-quality content
 * Checks for random characters, keyboard mashing, excessive repetition
 * @param {string} content - Message content
 * @returns {boolean} Whether the message is gibberish
 */
function isGibberish(content) {
  if (!content || content.length < 5) return false;

  const text = content.trim();

  // Allow URLs, mentions, emojis (these are valid short messages)
  if (/^(<[@#!&]|https?:\/\/|<:\w+:\d+>)/.test(text)) return false;

  // Check 1: Excessive single-character repetition (e.g., "aaaaaaa", "1111111")
  if (/(.)\1{6,}/.test(text)) return true;

  // Check 2: Random consonant clusters without vowels (keyboard mashing)
  // Skip this check if text contains CJK characters (Chinese/Japanese/Korean)
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
  if (!hasCJK) {
    const words = text.split(/\s+/);
    const mashCount = words.filter(w => {
      const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (clean.length < 4) return false;
      // No vowels in a 4+ letter word
      return !/[aeiou]/i.test(clean);
    }).length;
    if (words.length > 0 && mashCount / words.length > 0.7 && words.length >= 2) return true;
  }

  // Check 3: Excessive special characters (>60% non-alphanumeric, non-space, non-CJK)
  const alphaNum = text.replace(/[\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, '');
  if (alphaNum.length > 5) {
    const specialCount = alphaNum.replace(/[a-zA-Z0-9]/g, '').length;
    if (specialCount / alphaNum.length > 0.6) return true;
  }

  // Check 4: Repeating short patterns (e.g., "abcabcabc", "hahahahaha")
  if (text.length >= 10) {
    for (let patLen = 1; patLen <= 3; patLen++) {
      const pat = text.slice(0, patLen);
      const repeated = pat.repeat(Math.ceil(text.length / patLen)).slice(0, text.length);
      if (repeated === text) return true;
    }
  }

  return false;
}

/**
 * Check if the message should be scored (spam prevention)
 * @param {string} userId - User ID
 * @param {string} content - Message content
 * @returns {boolean}
 */
function shouldScoreMessage(userId, content) {
  const now = Date.now();

  // Check message length
  if (content.length < config.activity.minMessageLength) {
    return false;
  }

  // Check for gibberish/low-quality content
  if (isGibberish(content)) {
    return false;
  }

  // Feature 2: Check for duplicate messages
  if (isDuplicateMessage(userId, content)) {
    return false;
  }

  // Check cooldown (no duplicate scoring within 10 seconds)
  const lastTime = recentMessages.get(userId);
  if (lastTime && now - lastTime < config.activity.cooldownMs) {
    return false;
  }

  // Check spam threshold (50 messages per minute)
  const spamData = spamTracker.get(userId);
  if (spamData) {
    if (now - spamData.windowStart < 60000) {
      if (spamData.count >= 50) {
        return false;
      }
      spamData.count++;
    } else {
      spamTracker.set(userId, { count: 1, windowStart: now });
    }
  } else {
    spamTracker.set(userId, { count: 1, windowStart: now });
  }

  // Update last message time
  recentMessages.set(userId, now);

  return true;
}

/**
 * Handle message create event
 * @param {Message} message - Discord message object
 */
async function handleMessage(message) {
  // Ignore bots
  if (message.author.bot) return;

  // Check if tracking is enabled
  const settings = await getActivitySettingsIfEnabled(message.guild.id);
  if (!settings) return;

  // Check if the channel is within tracking scope
  if (!isChannelTracked(message.channel.id, settings)) return;

  // Check spam prevention
  if (!shouldScoreMessage(message.author.id, message.content)) return;

  // Track message
  trackActivity(message.guild.id, message.author.id, 'message', 1);

  // Track reply (if replying to someone else)
  if (message.reference && message.reference.messageId) {
    try {
      const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedMessage.author.id !== message.author.id) {
        trackActivity(message.guild.id, message.author.id, 'reply', 1);
      }
    } catch (error) {
      // Failed to get original message, still count as normal message
    }
  }
}

/**
 * Handle message delete event (decrement points)
 * @param {Message} message - Discord message object
 */
async function handleMessageDelete(message) {
  if (message.author?.bot) return;
  if (!message.guild) return;

  const settings = await getActivitySettingsIfEnabled(message.guild.id);
  if (!settings) return;

  // Decrement activity
  await db.decrementActivity(message.guild.id, message.author.id, 'message', 1);

  // If it's a reply, also decrement reply points
  if (message.reference) {
    await db.decrementActivity(message.guild.id, message.author.id, 'reply', 1);
  }
}

/**
 * Handle emoji reaction add event
 * @param {MessageReaction} reaction - Discord reaction object
 * @param {User} user - User who added the reaction
 */
async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  if (!reaction.message.guild) return;

  const settings = await getActivitySettingsIfEnabled(reaction.message.guild.id);
  if (!settings) return;

  // Check if the channel is within tracking scope
  if (!isChannelTracked(reaction.message.channel.id, settings)) return;

  // Don't count reactions on own messages
  if (reaction.message.author?.id === user.id) return;

  // Anti-farming: Check reaction pattern
  const now = Date.now();
  const rKey = `${reaction.message.guild.id}_${user.id}`;
  let rData = reactionTracker.get(rKey);

  if (!rData || now - rData.windowStart > REACTION_WINDOW_MS) {
    rData = { count: 0, windowStart: now, uniqueMessages: new Set() };
    reactionTracker.set(rKey, rData);
  }

  rData.count++;
  rData.uniqueMessages.add(reaction.message.id);

  // Block if too many reactions in window
  if (rData.count > REACTION_MAX_PER_WINDOW) {
    return;
  }

  // Block if reacting to too few unique messages (mass-reacting same messages)
  if (rData.count > 10 && rData.uniqueMessages.size / rData.count < REACTION_UNIQUE_RATIO) {
    securityLogger.flagUser(reaction.message.guild.id, user.id, 'reaction_farming');
    return;
  }

  trackActivity(reaction.message.guild.id, user.id, 'reaction', 1);
}

/**
 * Handle voice state update event
 * @param {VoiceState} oldState - Previous voice state
 * @param {VoiceState} newState - New voice state
 */
async function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.member?.id || oldState.member?.id;
  const guildId = newState.guild?.id || oldState.guild?.id;

  if (!userId || !guildId) return;
  if (newState.member?.user?.bot) return;

  const settings = await getActivitySettingsIfEnabled(guildId);
  if (!settings) return;

  const sessionKey = `${guildId}_${userId}`;

  // User joins voice channel
  if (!oldState.channel && newState.channel) {
    voiceSessions.set(sessionKey, {
      joinTime: Date.now(),
      lastCheckpoint: Date.now(),
      channelId: newState.channel.id,
      muted: newState.selfMute || newState.serverMute,
      deafened: newState.selfDeaf || newState.serverDeaf,
    });
  }

  // User changes mute/deafen state while in channel
  if (oldState.channel && newState.channel) {
    const session = voiceSessions.get(sessionKey);
    if (session) {
      session.muted = newState.selfMute || newState.serverMute;
      session.deafened = newState.selfDeaf || newState.serverDeaf;
    }
  }

  // User leaves voice channel — award remaining time since last checkpoint
  if (oldState.channel && !newState.channel) {
    const session = voiceSessions.get(sessionKey);
    if (session) {
      const minutes = Math.floor((Date.now() - session.lastCheckpoint) / 60000);

      // Anti-AFK: Check if there were other non-bot users in the channel
      const channelMembers = oldState.channel.members.filter(m => !m.user.bot && m.id !== userId);
      const hasOtherUsers = channelMembers.size >= 1;

      if (minutes > 0 && hasOtherUsers) {
        const effectiveMinutes = calcEffectiveVoiceMinutes(minutes, session);
        if (effectiveMinutes > 0) {
          trackActivity(guildId, userId, 'voice', effectiveMinutes);
        }
      }
      voiceSessions.delete(sessionKey);
    }
  }
}

/**
 * Calculate effective voice minutes with AFK penalties
 * @param {number} rawMinutes - Raw minutes
 * @param {Object} session - Voice session data
 * @returns {number} Effective minutes after penalties
 */
function calcEffectiveVoiceMinutes(rawMinutes, session) {
  let effective = rawMinutes;
  if (session.deafened && session.muted) {
    effective = 0; // Full AFK — no credit
  } else if (session.deafened || session.muted) {
    effective = Math.floor(rawMinutes * 0.5); // Partial credit
  }
  // Cap at 4 hours per checkpoint cycle
  return Math.min(effective, 240);
}

/**
 * Periodic voice session scoring — awards points every 5 minutes
 * to prevent total loss on crash
 */
async function processVoiceSessions() {
  if (!discordClient || voiceSessions.size === 0) return;

  const now = Date.now();

  for (const [sessionKey, session] of voiceSessions.entries()) {
    const minutes = Math.floor((now - session.lastCheckpoint) / 60000);
    if (minutes < 1) continue;

    const [guildId, userId] = sessionKey.split('_');

    // Check if channel still has other users
    try {
      const guild = discordClient.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(session.channelId);
      if (!channel) continue;

      const otherMembers = channel.members.filter(m => !m.user.bot && m.id !== userId);
      if (otherMembers.size < 1) continue; // Alone — no credit

      const effectiveMinutes = calcEffectiveVoiceMinutes(minutes, session);
      if (effectiveMinutes > 0) {
        trackActivity(guildId, userId, 'voice', effectiveMinutes);
      }
    } catch (e) {
      // Channel fetch failed — skip this session
      continue;
    }

    // Advance checkpoint regardless (so we don't re-count this interval)
    session.lastCheckpoint = now;
  }
}

/**
 * Batch process events in the queue
 */
async function processBatch() {
  // Get and clear the queue
  const events = activityQueue.splice(0);

  if (events.length === 0) return;

  // Aggregate events by guild/user
  const aggregated = {};
  const guildSettings = {}; // Cache guild settings

  for (const event of events) {
    const key = `${event.guildId}_${event.userId}`;

    if (!aggregated[key]) {
      aggregated[key] = {
        guildId: event.guildId,
        userId: event.userId,
        message_count: 0,
        reply_count: 0,
        reaction_count: 0,
        voice_minutes: 0,
      };
    }

    // Cache guild settings
    if (!guildSettings[event.guildId]) {
      guildSettings[event.guildId] = await db.getActivitySettings(event.guildId);
    }

    switch (event.type) {
      case 'message':
        aggregated[key].message_count += event.value;
        break;
      case 'reply':
        aggregated[key].reply_count += event.value;
        break;
      case 'reaction':
        aggregated[key].reaction_count += event.value;
        break;
      case 'voice':
        aggregated[key].voice_minutes += event.value;
        break;
    }
  }

  // Group by guild for processing, using respective custom scores
  const guildGroups = {};
  for (const data of Object.values(aggregated)) {
    if (!guildGroups[data.guildId]) {
      guildGroups[data.guildId] = [];
    }
    guildGroups[data.guildId].push(data);
  }

  // Batch write to database (using custom scores)
  try {
    for (const [guildId, updates] of Object.entries(guildGroups)) {
      const settings = guildSettings[guildId];
      await db.batchUpdateActivity(updates, settings);

      // Anomaly detection: check for activity spikes
      for (const update of updates) {
        checkActivityAnomaly(guildId, update.userId, update);
      }
    }
    console.log(`✅ Processed ${events.length} activity events`);
  } catch (error) {
    console.error('❌ Failed to update activity:', error.message);
    // Put events back into queue on failure
    activityQueue.push(...events);
  }
}

/**
 * Check for activity anomalies (sudden spikes)
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {Object} update - Current batch update data
 */
function checkActivityAnomaly(guildId, userId, update) {
  const key = `${guildId}_${userId}`;
  const today = new Date().toISOString().split('T')[0];

  if (!activityBaseline.has(key)) {
    activityBaseline.set(key, { history: [], lastDate: null });
  }

  const baseline = activityBaseline.get(key);
  const todayScore = (update.message_count || 0) + (update.reply_count || 0) +
                     (update.reaction_count || 0) + (update.voice_minutes || 0);

  // Update today's running total
  if (baseline.lastDate === today) {
    baseline.todayTotal = (baseline.todayTotal || 0) + todayScore;
  } else {
    // New day — push yesterday's total to history
    if (baseline.lastDate && baseline.todayTotal > 0) {
      baseline.history.push({ date: baseline.lastDate, score: baseline.todayTotal });
      if (baseline.history.length > BASELINE_DAYS) {
        baseline.history.shift();
      }
    }
    baseline.lastDate = today;
    baseline.todayTotal = todayScore;
  }

  // Need at least 3 days of history to detect anomalies
  if (baseline.history.length < 3) return;

  const avgScore = baseline.history.reduce((sum, d) => sum + d.score, 0) / baseline.history.length;

  // Flag if today's activity is 5x the average
  if (avgScore > 0 && baseline.todayTotal > avgScore * ANOMALY_MULTIPLIER) {
    securityLogger.flagUser(guildId, userId, 'activity_spike');
    securityLogger.logSecurityEvent(securityLogger.SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
      guildId,
      userId,
      details: {
        reason: 'Activity spike detected',
        todayTotal: baseline.todayTotal,
        avgScore: Math.round(avgScore),
        multiplier: Math.round(baseline.todayTotal / avgScore)
      }
    });
  }
}

/**
 * Clean up expired tracking data
 */
function cleanupTrackingData() {
  const now = Date.now();
  const maxAge = 3600000; // 1 hour

  // Clean up recent messages
  for (const [userId, timestamp] of recentMessages.entries()) {
    if (now - timestamp > maxAge) {
      recentMessages.delete(userId);
    }
  }

  // Clean up spam tracker
  for (const [userId, data] of spamTracker.entries()) {
    if (now - data.windowStart > maxAge) {
      spamTracker.delete(userId);
    }
  }

  // Clean up message history (Feature 2: Duplicate message detection)
  // Only keep history of active users
  for (const [userId] of userMessageHistory.entries()) {
    const lastActive = recentMessages.get(userId);
    if (!lastActive || now - lastActive > maxAge) {
      userMessageHistory.delete(userId);
    }
  }

  // Clean up reaction tracker
  for (const [key, data] of reactionTracker.entries()) {
    if (now - data.windowStart > REACTION_WINDOW_MS * 2) {
      reactionTracker.delete(key);
    }
  }

  // Clean up activity baselines older than 14 days of inactivity
  for (const [key, baseline] of activityBaseline.entries()) {
    if (baseline.lastDate) {
      const lastDate = new Date(baseline.lastDate).getTime();
      if (now - lastDate > 14 * 86400000) {
        activityBaseline.delete(key);
      }
    }
  }

  console.log('🧹 Cleaned up tracking data');
}

/**
 * Get queue statistical information
 */
function getQueueStats() {
  return {
    queueLength: activityQueue.length,
    recentMessagesTracked: recentMessages.size,
    activeVoiceSessions: voiceSessions.size,
    spamTrackerEntries: spamTracker.size,
  };
}

module.exports = {
  initActivityTracker,
  getActivitySettingsIfEnabled,
  isChannelTracked,
  trackActivity,
  handleMessage,
  handleMessageDelete,
  handleReactionAdd,
  handleVoiceStateUpdate,
  getQueueStats,
  isGibberish,
};
