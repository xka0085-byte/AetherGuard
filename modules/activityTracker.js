/**
 * 文件名：activityTracker.js
 * 用途：活跃度追踪模块（简化版 - 无 Redis）
 *
 * 测试方法：
 * 1. 启动机器人
 * 2. 在已配置的服务器发送消息
 * 3. 运行 /my-activity 应显示积分
 *
 * 改动说明：
 * - 删除 Redis 队列支持（只使用内存队列）
 * - 删除 flagUser 函数（不再需要反滥用）
 * - 简化 isTrackingEnabled 检查
 * - 从 407 行简化为 ~250 行
 */

const config = require('../config');
const db = require('../database/db');

// 内存队列用于活跃度事件
let activityQueue = [];

// 追踪最近消息用于冷却（userId -> timestamp）
const recentMessages = new Map();

// 追踪消息数量用于垃圾检测（userId -> { count, windowStart }）
const spamTracker = new Map();

// 追踪语音会话开始时间（guildId_userId -> timestamp）
const voiceSessions = new Map();

// ========== 功能2：重复消息检测 ==========
// 追踪用户最近10条消息（userId -> Array<string>）
const userMessageHistory = new Map();
const MESSAGE_HISTORY_SIZE = 10;
const SIMILARITY_THRESHOLD = 0.8; // 相似度阈值（80%）

/**
 * 初始化活跃度追踪器
 */
function initActivityTracker() {
  // 启动批量处理定时器
  setInterval(processBatch, config.activity.queue.processInterval);

  // 启动清理定时器（每小时清理一次过期数据）
  setInterval(cleanupTrackingData, 3600000);

  console.log(`✅ Activity tracker initialized (batch interval: ${config.activity.queue.processInterval}ms)`);
}

/**
 * 检查服务器是否启用了活跃度追踪
 * @param {string} guildId - 服务器ID
 * @returns {Promise<Object|null>} 返回活跃度设置或null
 */
async function getActivitySettingsIfEnabled(guildId) {
  if (!config.activity.enabled) return null;

  const settings = await db.getActivitySettings(guildId);
  if (!settings || !settings.enabled) return null;

  return settings;
}

/**
 * 检查频道是否在追踪范围内
 * @param {string} guildId - 服务器ID
 * @param {string} channelId - 频道ID
 * @param {Object} settings - 活跃度设置
 * @returns {boolean}
 */
function isChannelTracked(channelId, settings) {
  if (!settings.tracking_channels) return true; // 未设置则追踪所有频道

  try {
    const trackedChannels = JSON.parse(settings.tracking_channels);
    return trackedChannels.includes(channelId);
  } catch {
    return true; // 解析失败则追踪所有频道
  }
}

/**
 * 记录活跃度事件
 * @param {string} guildId - 服务器ID
 * @param {string} userId - 用户ID
 * @param {string} type - 事件类型: 'message', 'reply', 'reaction', 'voice'
 * @param {number} value - 值（默认: 1）
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
 * 计算两个字符串的相似度（Jaccard相似度）
 * @param {string} str1 - 字符串1
 * @param {string} str2 - 字符串2
 * @returns {number} 相似度 (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  // 转为小写并分词
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  // 计算交集
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  // 计算并集
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 检查消息是否与最近消息重复
 * @param {string} userId - 用户ID
 * @param {string} content - 消息内容
 * @returns {boolean} 是否重复
 */
function isDuplicateMessage(userId, content) {
  if (!content || content.length < 5) return false;

  const history = userMessageHistory.get(userId) || [];

  // 检查是否与最近消息相似
  for (const prevMsg of history) {
    const similarity = calculateSimilarity(content, prevMsg);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return true; // 重复消息
    }
  }

  // 添加到历史记录
  history.push(content);
  if (history.length > MESSAGE_HISTORY_SIZE) {
    history.shift(); // 保持最近10条
  }
  userMessageHistory.set(userId, history);

  return false;
}

/**
 * 检查消息是否应该计分（防垃圾）
 * @param {string} userId - 用户ID
 * @param {string} content - 消息内容
 * @returns {boolean}
 */
function shouldScoreMessage(userId, content) {
  const now = Date.now();

  // 检查消息长度
  if (content.length < config.activity.minMessageLength) {
    return false;
  }

  // 功能2：检查重复消息
  if (isDuplicateMessage(userId, content)) {
    return false;
  }

  // 检查冷却（10秒内不重复计分）
  const lastTime = recentMessages.get(userId);
  if (lastTime && now - lastTime < config.activity.cooldownMs) {
    return false;
  }

  // 检查垃圾阈值（每分钟50条消息）
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

  // 更新最后消息时间
  recentMessages.set(userId, now);

  return true;
}

/**
 * 处理消息创建事件
 * @param {Message} message - Discord 消息对象
 */
async function handleMessage(message) {
  // 忽略机器人
  if (message.author.bot) return;

  // 检查是否启用追踪
  const settings = await getActivitySettingsIfEnabled(message.guild.id);
  if (!settings) return;

  // 检查频道是否在追踪范围内
  if (!isChannelTracked(message.channel.id, settings)) return;

  // 检查防垃圾
  if (!shouldScoreMessage(message.author.id, message.content)) return;

  // 追踪消息
  trackActivity(message.guild.id, message.author.id, 'message', 1);

  // 追踪回复（如果回复的是其他人）
  if (message.reference && message.reference.messageId) {
    try {
      const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedMessage.author.id !== message.author.id) {
        trackActivity(message.guild.id, message.author.id, 'reply', 1);
      }
    } catch (error) {
      // 无法获取原消息，仍然计为普通消息
    }
  }
}

/**
 * 处理消息删除事件（减少积分）
 * @param {Message} message - Discord 消息对象
 */
async function handleMessageDelete(message) {
  if (message.author?.bot) return;
  if (!message.guild) return;

  const settings = await getActivitySettingsIfEnabled(message.guild.id);
  if (!settings) return;

  // 减少活跃度
  await db.decrementActivity(message.guild.id, message.author.id, 'message', 1);

  // 如果是回复，也减少回复积分
  if (message.reference) {
    await db.decrementActivity(message.guild.id, message.author.id, 'reply', 1);
  }
}

/**
 * 处理表情反应添加事件
 * @param {MessageReaction} reaction - Discord 反应对象
 * @param {User} user - 添加反应的用户
 */
async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  if (!reaction.message.guild) return;

  const settings = await getActivitySettingsIfEnabled(reaction.message.guild.id);
  if (!settings) return;

  // 检查频道是否在追踪范围内
  if (!isChannelTracked(reaction.message.channel.id, settings)) return;

  // 不计算自己消息上的反应
  if (reaction.message.author?.id === user.id) return;

  trackActivity(reaction.message.guild.id, user.id, 'reaction', 1);
}

/**
 * 处理语音状态更新事件
 * @param {VoiceState} oldState - 之前的语音状态
 * @param {VoiceState} newState - 新的语音状态
 */
async function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.member?.id || oldState.member?.id;
  const guildId = newState.guild?.id || oldState.guild?.id;

  if (!userId || !guildId) return;
  if (newState.member?.user?.bot) return;

  const settings = await getActivitySettingsIfEnabled(guildId);
  if (!settings) return;

  const sessionKey = `${guildId}_${userId}`;

  // 用户加入语音频道
  if (!oldState.channel && newState.channel) {
    voiceSessions.set(sessionKey, Date.now());
  }

  // 用户离开语音频道
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
 * 批量处理队列中的事件
 */
async function processBatch() {
  // 获取并清空队列
  const events = activityQueue.splice(0);

  if (events.length === 0) return;

  // 按服务器/用户聚合事件
  const aggregated = {};
  const guildSettings = {}; // 缓存服务器设置

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

    // 缓存服务器设置
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

  // 按服务器分组处理，使用各自的自定义分数
  const guildGroups = {};
  for (const data of Object.values(aggregated)) {
    if (!guildGroups[data.guildId]) {
      guildGroups[data.guildId] = [];
    }
    guildGroups[data.guildId].push(data);
  }

  // 批量写入数据库（使用自定义分数）
  try {
    for (const [guildId, updates] of Object.entries(guildGroups)) {
      const settings = guildSettings[guildId];
      await db.batchUpdateActivity(updates, settings);
    }
    console.log(`✅ Processed ${events.length} activity events`);
  } catch (error) {
    console.error('❌ Failed to update activity:', error.message);
    // 失败时将事件放回队列
    activityQueue.push(...events);
  }
}

/**
 * 清理过期的追踪数据
 */
function cleanupTrackingData() {
  const now = Date.now();
  const maxAge = 3600000; // 1 小时

  // 清理最近消息
  for (const [userId, timestamp] of recentMessages.entries()) {
    if (now - timestamp > maxAge) {
      recentMessages.delete(userId);
    }
  }

  // 清理垃圾追踪器
  for (const [userId, data] of spamTracker.entries()) {
    if (now - data.windowStart > maxAge) {
      spamTracker.delete(userId);
    }
  }

  // 清理消息历史（功能2：重复消息检测）
  // 只保留活跃用户的历史
  for (const [userId] of userMessageHistory.entries()) {
    const lastActive = recentMessages.get(userId);
    if (!lastActive || now - lastActive > maxAge) {
      userMessageHistory.delete(userId);
    }
  }

  console.log('🧹 Cleaned up tracking data');
}

/**
 * 获取队列统计信息
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