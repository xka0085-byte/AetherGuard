/**
 * Filename: securityLogger.js
 * Purpose: Security event logging and administrator operation auditing
 *
 * Features:
 * 1. Security event logs (verification failure, rate limiting, abnormal behavior)
 * 2. Administrator operation auditing (configuration change records)
 * 3. User behavior tracking (Discord cannot get IP, but can track user behavior patterns)
 */

const fs = require('fs');
const path = require('path');

// Log file paths
const LOG_DIR = path.join(__dirname, '..', 'logs');
const SECURITY_LOG = path.join(LOG_DIR, 'security.log');
const AUDIT_LOG = path.join(LOG_DIR, 'audit.log');
const USER_ACTIVITY_LOG = path.join(LOG_DIR, 'user_activity.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

// Security event types
const SECURITY_EVENTS = {
  // Verification related
  VERIFY_SUCCESS: 'VERIFY_SUCCESS',
  VERIFY_FAILED: 'VERIFY_FAILED',
  VERIFY_INVALID_ADDRESS: 'VERIFY_INVALID_ADDRESS',

  // Rate limiting
  RATE_LIMIT_COMMAND: 'RATE_LIMIT_COMMAND',
  RATE_LIMIT_VERIFY: 'RATE_LIMIT_VERIFY',
  RATE_LIMIT_SPAM: 'RATE_LIMIT_SPAM',

  // Abnormal behavior
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  DAILY_CAP_REACHED: 'DAILY_CAP_REACHED',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',

  // Anti-Sybil
  CROSS_GUILD_SYBIL: 'CROSS_GUILD_SYBIL',
  ACTIVITY_SPIKE: 'ACTIVITY_SPIKE',
  REACTION_FARMING: 'REACTION_FARMING',
  PENALTY_APPLIED: 'PENALTY_APPLIED',

  // System events
  BOT_STARTED: 'BOT_STARTED',
  BOT_SHUTDOWN: 'BOT_SHUTDOWN',
  DATABASE_ERROR: 'DATABASE_ERROR',
  API_ERROR: 'API_ERROR'
};

// Audit event types
const AUDIT_EVENTS = {
  // Configuration changes
  SETUP_NFT: 'SETUP_NFT',
  SETUP_ACTIVITY: 'SETUP_ACTIVITY',

  // User management
  USER_VERIFIED: 'USER_VERIFIED',
  USER_UNVERIFIED: 'USER_UNVERIFIED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_REMOVED: 'ROLE_REMOVED',

  // System management
  WEEKLY_RESET: 'WEEKLY_RESET',
  LEADERBOARD_POSTED: 'LEADERBOARD_POSTED'
};

/**
 * Format timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Write to log file
 */
function writeLog(filePath, content) {
  const logLine = `${content}\n`;
  fs.appendFileSync(filePath, logLine, 'utf8');
}

/**
 * Sanitize sensitive data before logging
 * Masks wallet addresses, tokens, and API keys
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === 'string') {
      // Mask wallet addresses: 0x1234...abcd
      if (/^0x[a-fA-F0-9]{40}$/.test(val)) {
        result[key] = val.slice(0, 6) + '...' + val.slice(-4);
      }
      // Mask tx hashes: 0xabcd...ef01
      else if (/^0x[a-fA-F0-9]{64}$/.test(val)) {
        result[key] = val.slice(0, 6) + '...' + val.slice(-4);
      }
    } else if (typeof val === 'object' && val !== null) {
      result[key] = sanitize(val);
    }
  }
  return result;
}

/**
 * Format log entry
 */
function formatLogEntry(level, event, data) {
  return JSON.stringify(sanitize({
    timestamp: getTimestamp(),
    level,
    event,
    ...data
  }));
}

// ==================== Security Event Logs ====================

/**
 * Record security event
 * @param {string} event - Event type
 * @param {object} data - Event data
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

  // If it's a critical event, also output to console
  if (level === LOG_LEVELS.CRITICAL || level === LOG_LEVELS.ERROR) {
    console.log(`🔴 [SECURITY] ${event}: ${JSON.stringify(data.details || {})}`);
  } else if (level === LOG_LEVELS.WARN) {
    console.log(`🟡 [SECURITY] ${event}: ${JSON.stringify(data.details || {})}`);
  }
}

/**
 * Get log level based on event type
 */
function getSecurityLevel(event) {
  const criticalEvents = ['SUSPICIOUS_ACTIVITY', 'DATABASE_ERROR', 'CROSS_GUILD_SYBIL'];
  const errorEvents = ['API_ERROR', 'VERIFY_FAILED', 'PENALTY_APPLIED'];
  const warnEvents = ['RATE_LIMIT_COMMAND', 'RATE_LIMIT_VERIFY', 'RATE_LIMIT_SPAM',
                      'DAILY_CAP_REACHED', 'DUPLICATE_MESSAGE', 'VERIFY_INVALID_ADDRESS',
                      'ACTIVITY_SPIKE', 'REACTION_FARMING'];

  if (criticalEvents.includes(event)) return LOG_LEVELS.CRITICAL;
  if (errorEvents.includes(event)) return LOG_LEVELS.ERROR;
  if (warnEvents.includes(event)) return LOG_LEVELS.WARN;
  return LOG_LEVELS.INFO;
}

// ==================== Administrator Operation Auditing ====================

/**
 * Record administrator operation
 * @param {string} event - Audit event type
 * @param {object} data - Event data
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

  // Output to console
  console.log(`📋 [AUDIT] ${event} by ${data.adminTag || 'System'} in ${data.guildName || data.guildId}`);
}

// ==================== User Behavior Tracking ====================

// In-memory user behavior tracker
const userBehaviorTracker = new Map();

/**
 * Track user behavior
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} action - Action type
 * @param {object} metadata - Metadata
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

  // Record behavior
  tracker.actions.push({
    action,
    timestamp: now,
    ...metadata
  });

  // Keep only the last 100 records
  if (tracker.actions.length > 100) {
    tracker.actions = tracker.actions.slice(-100);
  }

  // Update statistics
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

  // Detect suspicious behavior
  detectSuspiciousBehavior(guildId, userId, tracker);
}

/**
 * Detect suspicious behavior
 */
function detectSuspiciousBehavior(guildId, userId, tracker) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_MINUTE = 60 * 1000;

  // Get behavior in the last 1 hour
  const recentActions = tracker.actions.filter(a => now - a.timestamp < ONE_HOUR);
  const recentVerifyAttempts = recentActions.filter(a => a.action === 'verify').length;

  // Detection: More than 20 verification attempts in 1 hour
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

  // Detection: More than 30 commands in 1 minute
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
 * Get user behavior report
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 */
function getUserBehaviorReport(guildId, userId) {
  const key = `${guildId}:${userId}`;
  return userBehaviorTracker.get(key) || null;
}

/**
 * Flag user as suspicious
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} reason - Reason
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
 * Check if the user is flagged
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 */
function isUserFlagged(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const tracker = userBehaviorTracker.get(key);
  return tracker ? tracker.flags.length > 0 : false;
}

/**
 * Get user flags list
 */
function getUserFlags(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const tracker = userBehaviorTracker.get(key);
  return tracker ? tracker.flags : [];
}

// ==================== Progressive Penalty System ====================

// Penalty levels: each flag adds a penalty level
// Level 1: Warning (logged only)
// Level 2: Score multiplier reduced to 50%
// Level 3: Score multiplier reduced to 0% (effectively muted from scoring)
const PENALTY_THRESHOLDS = {
  WARNING: 1,      // 1 flag = warning
  REDUCED: 2,      // 2 flags = 50% score
  BLOCKED: 3,      // 3+ flags = 0% score (no activity points)
};

/**
 * Get penalty multiplier for a user based on their flags
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @returns {number} Score multiplier (0.0 to 1.0)
 */
function getPenaltyMultiplier(guildId, userId) {
  const flags = getUserFlags(guildId, userId);
  const flagCount = flags.length;

  if (flagCount >= PENALTY_THRESHOLDS.BLOCKED) return 0;
  if (flagCount >= PENALTY_THRESHOLDS.REDUCED) return 0.5;
  return 1.0;
}

/**
 * Check if user is blocked from scoring
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @returns {boolean}
 */
function isUserBlocked(guildId, userId) {
  return getPenaltyMultiplier(guildId, userId) === 0;
}

// ==================== Log Query ====================

/**
 * Read recent security logs
 * @param {number} lines - Number of lines
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
 * Read recent audit logs
 * @param {number} lines - Number of lines
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
 * Clean up old logs (keep the last 7 days)
 */
function cleanupOldLogs() {
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
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

  // Clean up user tracking data in memory
  for (const [key, tracker] of userBehaviorTracker.entries()) {
    if (now - tracker.lastSeen > MAX_AGE_MS) {
      userBehaviorTracker.delete(key);
    }
  }

  console.log('🧹 Cleaned up old logs');
}

// Clean up old logs once a day
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

module.exports = {
  // Event type constants
  SECURITY_EVENTS,
  AUDIT_EVENTS,
  LOG_LEVELS,

  // Security event logs
  logSecurityEvent,

  // Audit logs
  logAuditEvent,

  // User behavior tracking
  trackUserBehavior,
  getUserBehaviorReport,
  flagUser,
  isUserFlagged,
  getUserFlags,

  // Progressive penalty system
  getPenaltyMultiplier,
  isUserBlocked,
  PENALTY_THRESHOLDS,

  // Log query
  getRecentSecurityLogs,
  getRecentAuditLogs,
  cleanupOldLogs
};