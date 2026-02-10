/**
 * 文件名：securityLogger.js
 * 用途：安全事件日志和管理员操作审计
 *
 * 功能：
 * 1. 安全事件日志（验证失败、速率限制、异常行为）
 * 2. 管理员操作审计（配置变更记录）
 * 3. 用户行为追踪（Discord无法获取IP，但可追踪用户行为模式）
 */

const fs = require('fs');
const path = require('path');

// 日志文件路径
const LOG_DIR = path.join(__dirname, '..', 'logs');
const SECURITY_LOG = path.join(LOG_DIR, 'security.log');
const AUDIT_LOG = path.join(LOG_DIR, 'audit.log');
const USER_ACTIVITY_LOG = path.join(LOG_DIR, 'user_activity.log');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志级别
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

// 安全事件类型
const SECURITY_EVENTS = {
  // 验证相关
  VERIFY_SUCCESS: 'VERIFY_SUCCESS',
  VERIFY_FAILED: 'VERIFY_FAILED',
  VERIFY_INVALID_ADDRESS: 'VERIFY_INVALID_ADDRESS',

  // 速率限制
  RATE_LIMIT_COMMAND: 'RATE_LIMIT_COMMAND',
  RATE_LIMIT_VERIFY: 'RATE_LIMIT_VERIFY',
  RATE_LIMIT_SPAM: 'RATE_LIMIT_SPAM',

  // 异常行为
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  DAILY_CAP_REACHED: 'DAILY_CAP_REACHED',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',

  // 系统事件
  BOT_STARTED: 'BOT_STARTED',
  BOT_SHUTDOWN: 'BOT_SHUTDOWN',
  DATABASE_ERROR: 'DATABASE_ERROR',
  API_ERROR: 'API_ERROR'
};

// 审计事件类型
const AUDIT_EVENTS = {
  // 配置变更
  SETUP_NFT: 'SETUP_NFT',
  SETUP_ACTIVITY: 'SETUP_ACTIVITY',

  // 用户管理
  USER_VERIFIED: 'USER_VERIFIED',
  USER_UNVERIFIED: 'USER_UNVERIFIED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_REMOVED: 'ROLE_REMOVED',

  // 系统管理
  WEEKLY_RESET: 'WEEKLY_RESET',
  LEADERBOARD_POSTED: 'LEADERBOARD_POSTED'
};

/**
 * 格式化时间戳
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * 写入日志文件
 */
function writeLog(filePath, content) {
  const logLine = `${content}\n`;
  fs.appendFileSync(filePath, logLine, 'utf8');
}

/**
 * 格式化日志条目
 */
function formatLogEntry(level, event, data) {
  return JSON.stringify({
    timestamp: getTimestamp(),
    level,
    event,
    ...data
  });
}

// ==================== 安全事件日志 ====================

/**
 * 记录安全事件
 * @param {string} event - 事件类型
 * @param {object} data - 事件数据
 */
function logSecurityEvent(event, data = {}) {
  const level = getSecurityLevel(event);
  const entry = formatLogEntry(level, event, {
    guildId: data.guildId || null,
    userId: data.userId || null,
    details: data.details || {},
    userTag: data.userTag || null
  });

  writeLog(SECURITY_LOG, entry);

  // 如果是严重事件，同时输出到控制台
  if (level === LOG_LEVELS.CRITICAL || level === LOG_LEVELS.ERROR) {
    console.log(`🔴 [SECURITY] ${event}: ${JSON.stringify(data.details || {})}`);
  } else if (level === LOG_LEVELS.WARN) {
    console.log(`🟡 [SECURITY] ${event}: ${JSON.stringify(data.details || {})}`);
  }
}

/**
 * 根据事件类型获取日志级别
 */
function getSecurityLevel(event) {
  const criticalEvents = ['SUSPICIOUS_ACTIVITY', 'DATABASE_ERROR'];
  const errorEvents = ['API_ERROR', 'VERIFY_FAILED'];
  const warnEvents = ['RATE_LIMIT_COMMAND', 'RATE_LIMIT_VERIFY', 'RATE_LIMIT_SPAM',
                      'DAILY_CAP_REACHED', 'DUPLICATE_MESSAGE', 'VERIFY_INVALID_ADDRESS'];

  if (criticalEvents.includes(event)) return LOG_LEVELS.CRITICAL;
  if (errorEvents.includes(event)) return LOG_LEVELS.ERROR;
  if (warnEvents.includes(event)) return LOG_LEVELS.WARN;
  return LOG_LEVELS.INFO;
}

// ==================== 管理员操作审计 ====================

/**
 * 记录管理员操作
 * @param {string} event - 审计事件类型
 * @param {object} data - 事件数据
 */
function logAuditEvent(event, data = {}) {
  const entry = formatLogEntry(LOG_LEVELS.INFO, event, {
    guildId: data.guildId || null,
    guildName: data.guildName || null,
    adminId: data.adminId || null,
    adminTag: data.adminTag || null,
    targetUserId: data.targetUserId || null,
    changes: data.changes || {},
    previousValues: data.previousValues || {},
    newValues: data.newValues || {}
  });

  writeLog(AUDIT_LOG, entry);

  // 输出到控制台
  console.log(`📋 [AUDIT] ${event} by ${data.adminTag || 'System'} in ${data.guildName || data.guildId}`);
}

// ==================== 用户行为追踪 ====================

// 内存中的用户行为追踪器
const userBehaviorTracker = new Map();

/**
 * 追踪用户行为
 * @param {string} guildId - 服务器ID
 * @param {string} userId - 用户ID
 * @param {string} action - 行为类型
 * @param {object} metadata - 元数据
 */
function trackUserBehavior(guildId, userId, action, metadata = {}) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  if (!userBehaviorTracker.has(key)) {
    userBehaviorTracker.set(key, {
      firstSeen: now,
      lastSeen: now,
      actions: [],
      verifyAttempts: 0,
      commandCount: 0,
      messageCount: 0,
      flags: []
    });
  }

  const tracker = userBehaviorTracker.get(key);
  tracker.lastSeen = now;

  // 记录行为
  tracker.actions.push({
    action,
    timestamp: now,
    ...metadata
  });

  // 只保留最近100条记录
  if (tracker.actions.length > 100) {
    tracker.actions = tracker.actions.slice(-100);
  }

  // 更新统计
  switch (action) {
    case 'verify':
      tracker.verifyAttempts++;
      break;
    case 'command':
      tracker.commandCount++;
      break;
    case 'message':
      tracker.messageCount++;
      break;
  }

  // 检测可疑行为
  detectSuspiciousBehavior(guildId, userId, tracker);
}

/**
 * 检测可疑行为
 */
function detectSuspiciousBehavior(guildId, userId, tracker) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_MINUTE = 60 * 1000;

  // 获取最近1小时的行为
  const recentActions = tracker.actions.filter(a => now - a.timestamp < ONE_HOUR);
  const recentVerifyAttempts = recentActions.filter(a => a.action === 'verify').length;

  // 检测：1小时内验证尝试超过20次
  if (recentVerifyAttempts > 20 && !tracker.flags.includes('excessive_verify')) {
    tracker.flags.push('excessive_verify');
    logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
      guildId,
      userId,
      details: {
        reason: 'Excessive verification attempts',
        count: recentVerifyAttempts,
        period: '1 hour'
      }
    });
  }

  // 检测：1分钟内命令超过30次
  const recentCommands = recentActions.filter(a =>
    a.action === 'command' && now - a.timestamp < ONE_MINUTE
  );
  if (recentCommands.length > 30 && !tracker.flags.includes('command_spam')) {
    tracker.flags.push('command_spam');
    logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
      guildId,
      userId,
      details: {
        reason: 'Command spam detected',
        count: recentCommands.length,
        period: '1 minute'
      }
    });
  }
}

/**
 * 获取用户行为报告
 * @param {string} guildId - 服务器ID
 * @param {string} userId - 用户ID
 */
function getUserBehaviorReport(guildId, userId) {
  const key = `${guildId}:${userId}`;
  return userBehaviorTracker.get(key) || null;
}

/**
 * 标记用户为可疑
 * @param {string} guildId - 服务器ID
 * @param {string} userId - 用户ID
 * @param {string} reason - 原因
 */
function flagUser(guildId, userId, reason) {
  const key = `${guildId}:${userId}`;

  if (!userBehaviorTracker.has(key)) {
    trackUserBehavior(guildId, userId, 'flag', { reason });
  }

  const tracker = userBehaviorTracker.get(key);
  if (!tracker.flags.includes(reason)) {
    tracker.flags.push(reason);
  }

  logSecurityEvent(SECURITY_EVENTS.SUSPICIOUS_ACTIVITY, {
    guildId,
    userId,
    details: { reason, flags: tracker.flags }
  });
}

/**
 * 检查用户是否被标记
 * @param {string} guildId - 服务器ID
 * @param {string} userId - 用户ID
 */
function isUserFlagged(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const tracker = userBehaviorTracker.get(key);
  return tracker ? tracker.flags.length > 0 : false;
}

/**
 * 获取用户标记列表
 */
function getUserFlags(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const tracker = userBehaviorTracker.get(key);
  return tracker ? tracker.flags : [];
}

// ==================== 日志查询 ====================

/**
 * 读取最近的安全日志
 * @param {number} lines - 行数
 */
function getRecentSecurityLogs(lines = 50) {
  try {
    if (!fs.existsSync(SECURITY_LOG)) return [];
    const content = fs.readFileSync(SECURITY_LOG, 'utf8');
    const allLines = content.trim().split('\n').filter(l => l);
    return allLines.slice(-lines).map(l => {
      try { return JSON.parse(l); } catch { return l; }
    });
  } catch (error) {
    console.error('Error reading security logs:', error.message);
    return [];
  }
}

/**
 * 读取最近的审计日志
 * @param {number} lines - 行数
 */
function getRecentAuditLogs(lines = 50) {
  try {
    if (!fs.existsSync(AUDIT_LOG)) return [];
    const content = fs.readFileSync(AUDIT_LOG, 'utf8');
    const allLines = content.trim().split('\n').filter(l => l);
    return allLines.slice(-lines).map(l => {
      try { return JSON.parse(l); } catch { return l; }
    });
  } catch (error) {
    console.error('Error reading audit logs:', error.message);
    return [];
  }
}

/**
 * 清理旧日志（保留最近7天）
 */
function cleanupOldLogs() {
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7天
  const now = Date.now();

  [SECURITY_LOG, AUDIT_LOG, USER_ACTIVITY_LOG].forEach(logFile => {
    try {
      if (!fs.existsSync(logFile)) return;

      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      const recentLines = lines.filter(line => {
        try {
          const entry = JSON.parse(line);
          const entryTime = new Date(entry.timestamp).getTime();
          return now - entryTime < MAX_AGE_MS;
        } catch {
          return false;
        }
      });

      fs.writeFileSync(logFile, recentLines.join('\n') + '\n', 'utf8');
    } catch (error) {
      console.error(`Error cleaning up ${logFile}:`, error.message);
    }
  });

  // 清理内存中的用户追踪数据
  for (const [key, tracker] of userBehaviorTracker.entries()) {
    if (now - tracker.lastSeen > MAX_AGE_MS) {
      userBehaviorTracker.delete(key);
    }
  }

  console.log('🧹 Cleaned up old logs');
}

// 每天清理一次旧日志
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

module.exports = {
  // 事件类型常量
  SECURITY_EVENTS,
  AUDIT_EVENTS,
  LOG_LEVELS,

  // 安全事件日志
  logSecurityEvent,

  // 审计日志
  logAuditEvent,

  // 用户行为追踪
  trackUserBehavior,
  getUserBehaviorReport,
  flagUser,
  isUserFlagged,
  getUserFlags,

  // 日志查询
  getRecentSecurityLogs,
  getRecentAuditLogs,
  cleanupOldLogs
};
