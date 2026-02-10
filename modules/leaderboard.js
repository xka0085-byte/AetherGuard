/**
 * 文件名：leaderboard.js
 * 用途：排行榜模块（简化版）
 *
 * 测试方法：
 * 1. 启动机器人
 * 2. 在服务器运行 /leaderboard
 * 3. 应该显示本周排行榜
 *
 * 改动说明：
 * - 删除 API 相关函数（getLeaderboardForAPI）
 * - 删除周数据保存（简化为只显示当前周）
 * - 从 343 行简化为 ~150 行
 */

const cron = require('node-cron');
const db = require('../database/db');

// Discord 客户端引用
let discordClient = null;

/**
 * 初始化排行榜模块
 * @param {Client} client - Discord.js 客户端实例
 */
function initLeaderboard(client) {
  discordClient = client;

  // 计划每周一 00:00 UTC 发布排行榜并重置
  cron.schedule('0 0 * * 1', async () => {
    console.log('📊 Running weekly leaderboard job...');
    await generateAndPostAllLeaderboards();
  }, {
    timezone: 'UTC',
  });

  console.log('✅ Leaderboard scheduler initialized (Monday 00:00 UTC)');
}

/**
 * 获取当前周的日期范围
 * @returns {{ weekStart: Date, weekEnd: Date }}
 */
function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();

  // 计算本周一
  const thisMonday = new Date(now);
  const daysToThisMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  thisMonday.setUTCDate(now.getUTCDate() - daysToThisMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);

  // 计算本周日
  const thisSunday = new Date(thisMonday);
  thisSunday.setUTCDate(thisMonday.getUTCDate() + 6);
  thisSunday.setUTCHours(23, 59, 59, 999);

  return {
    weekStart: thisMonday,
    weekEnd: thisSunday,
  };
}

/**
 * 格式化日期
 * @param {Date} date - 日期
 * @returns {string}
 */
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * 生成排行榜
 * @param {string} guildId - 服务器ID
 * @param {number} topN - 前 N 名（默认: 10）
 * @returns {Promise<Array>}
 */
async function generateLeaderboard(guildId, topN = 10) {
  const leaderboard = await db.getLeaderboard(guildId, topN);

  // 如果有 Discord 客户端，获取用户名
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
 * 发布排行榜到指定频道
 * @param {string} guildId - 服务器ID
 * @param {boolean} resetAfter - 发布后是否重置分数
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

    // 获取日期范围
    const { weekStart, weekEnd } = getCurrentWeekRange();

    // 生成排行榜
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

    // 重置分数
    if (resetAfter) {
      await db.resetWeeklyScores(guildId);
      console.log(`🔄 Reset weekly scores for guild ${guildId}`);
    }
  } catch (error) {
    console.error(`❌ Failed to post leaderboard for guild ${guildId}:`, error.message);
  }
}

/**
 * 为所有已配置的服务器生成并发布排行榜
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

    // 小延迟避免速率限制
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