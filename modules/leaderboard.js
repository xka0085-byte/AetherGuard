/**
 * Filename: leaderboard.js
 * Purpose: Leaderboard module (simplified version)
 *
 * Test Method:
 * 1. Start bot
 * 2. Run /leaderboard in the guild
 * 3. Should show this week's leaderboard
 *
 * Change Notes:
 * - Removed API related functions (getLeaderboardForAPI)
 * - Removed weekly data saving (simplified to show current week only)
 * - Simplified from 343 lines to ~150 lines
 */

const cron = require('node-cron');
const db = require('../database/db');

// Discord client reference
let discordClient = null;

/**
 * Initialize leaderboard module
 * @param {Client} client - Discord.js client instance
 */
function initLeaderboard(client) {
  discordClient = client;

  // Schedule weekly leaderboard posting and reset every Monday at 00:00 UTC
  cron.schedule('0 0 * * 1', async () => {
    console.log('📊 Running weekly leaderboard job...');
    await generateAndPostAllLeaderboards();
  }, {
    timezone: 'UTC',
  });

  console.log('✅ Leaderboard scheduler initialized (Monday 00:00 UTC)');
}

/**
 * Get the date range of the current week
 * @returns {{ weekStart: Date, weekEnd: Date }}
 */
function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  // Calculate this Monday
  const thisMonday = new Date(now);
  const daysToThisMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  thisMonday.setUTCDate(now.getUTCDate() - daysToThisMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);

  // Calculate this Sunday
  const thisSunday = new Date(thisMonday);
  thisSunday.setUTCDate(thisMonday.getUTCDate() + 6);
  thisSunday.setUTCHours(23, 59, 59, 999);

  return {
    weekStart: thisMonday,
    weekEnd: thisSunday,
  };
}

/**
 * Format date
 * @param {Date} date - Date
 * @returns {string}
 */
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Generate leaderboard
 * @param {string} guildId - Guild ID
 * @param {number} topN - Top N (default: 10)
 * @returns {Promise<Array>}
 */
async function generateLeaderboard(guildId, topN = 10) {
  const leaderboard = await db.getLeaderboard(guildId, topN);

  // If Discord client exists, fetch username
  if (discordClient) {
    for (const entry of leaderboard) {
      try {
        const user = await discordClient.users.fetch(entry.user_id);
        entry.username = user.username;
      } catch (e) {
        entry.username = null;
      }
    }
  }

  return leaderboard;
}

/**
 * Post leaderboard to the specified channel
 * @param {string} guildId - Guild ID
 * @param {boolean} resetAfter - Whether to reset scores after posting
 */
async function postLeaderboard(guildId, resetAfter = false) {
  if (!discordClient) {
    console.error('❌ Discord client not initialized');
    return;
  }

  const settings = await db.getActivitySettings(guildId);

  if (!settings || !settings.enabled) {
    console.log(`⚠️ Activity tracking disabled for guild ${guildId}`);
    return;
  }

  if (!settings.leaderboard_channel_id) {
    console.log(`⚠️ No leaderboard channel configured for guild ${guildId}`);
    return;
  }

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(settings.leaderboard_channel_id);

    if (!channel) {
      console.error(`❌ Leaderboard channel not found for guild ${guildId}`);
      return;
    }

    // Get date range
    const { weekStart, weekEnd } = getCurrentWeekRange();

    // Generate leaderboard
    const leaderboard = await generateLeaderboard(guildId, 10);

    if (leaderboard.length === 0) {
      console.log(`📊 No activity data for guild ${guildId}`);
      return;
    }

    // Build message
    let message = `🏆 **Weekly Activity Leaderboard**\n📅 ${formatDate(weekStart)} - ${formatDate(weekEnd)}\n\n`;

    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const username = entry.username || `User ${entry.user_id.slice(-4)}`;

      message += `${medal} **${username}** - ${(entry.total_score || 0).toLocaleString()} pts\n`;
      message += `   💬 ${entry.message_count || 0} | 💭 ${entry.reply_count || 0} | 🎤 ${entry.voice_minutes || 0}min\n\n`;
    }

    message += '💡 *A new week begins! Keep up the great work!*';

    await channel.send(message);
    console.log(`✅ Posted leaderboard to guild ${guildId}`);

    // Reset scores
    if (resetAfter) {
      await db.resetWeeklyScores(guildId);
      console.log(`🔄 Reset weekly scores for guild ${guildId}`);
    }
  } catch (error) {
    console.error(`❌ Failed to post leaderboard for guild ${guildId}:`, error.message);
  }
}

/**
 * Generate and post leaderboards for all configured guilds
 */
async function generateAndPostAllLeaderboards() {
  if (!discordClient) {
    console.error('❌ Discord client not initialized');
    return;
  }

  console.log('📊 Generating leaderboards for all guilds...');

  for (const [guildId] of discordClient.guilds.cache) {
    try {
      await postLeaderboard(guildId, true);
    } catch (error) {
      console.error(`❌ Error processing guild ${guildId}:`, error.message);
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('✅ All leaderboards processed');
}

module.exports = {
  initLeaderboard,
  getCurrentWeekRange,
  formatDate,
  generateLeaderboard,
  postLeaderboard,
  generateAndPostAllLeaderboards,
};
