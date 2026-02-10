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

// Memory queue for activity events
let activityQueue = [];

// Track recent messages for cooldown (userId -> timestamp)
const recentMessages = new Map();

// Track message count for spam detection (userId -> { count, windowStart })
const spamTracker = new Map();

// Track voice session start time (guildId_userId -> timestamp)
const voiceSessions = new Map();

// ========== Feature 2: Duplicate Message Detection ==========
// Track user's last 10 messages (userId -> Array<string>)
const userMessageHistory = new Map();
const MESSAGE_HISTORY_SIZE = 10;
const SIMILARITY_THRESHOLD = 0.8; // Similarity threshold (80%)

/**
 * Initialize activity tracker
 */
function initActivityTracker() {
  // Start batch processing timer
  setInterval(processBatch, config.activity.queue.processInterval);

  // Start cleanup timer (clean up expired data every hour)
  setInterval(cleanupTrackingData, 3600000);

  console.log(`✅ Activity tracker initialized (batch interval: ${config.activity.queue.processInterval}ms)`);
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
 * Calculate similarity between two strings (Jaccard similarity)
 * @param {string} str1 - String 1
 * @param {string} str2 - String 2
 * @returns {number} Similarity (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  // Convert to lowercase and tokenize
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  // Calculate intersection
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  // Calculate union
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
    voiceSessions.set(sessionKey, Date.now());
  }

  // User leaves voice channel
  if (oldState.channel && !newState.channel) {
    const joinTime = voiceSessions.get(sessionKey);
    if (joinTime) {
      const minutes = Math.floor((Date.now() - joinTime) / 60000);
      if (minutes > 0) {
        trackActivity(guildId, userId, 'voice', minutes);
      }
      voiceSessions.delete(sessionKey);
    }
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
    }
    console.log(`✅ Processed ${events.length} activity events`);
  } catch (error) {
    console.error('❌ Failed to update activity:', error.message);
    // Put events back into queue on failure
    activityQueue.push(...events);
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
};
