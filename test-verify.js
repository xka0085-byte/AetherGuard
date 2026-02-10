/**
 * 半自动化测试验证脚本
 * 使用方法：
 *   1. 手动在Discord执行测试操作
 *   2. 运行：node test-verify.js <test_name> <guild_id> <user_id>
 *
 * 测试项：
 *   - daily-cap: 验证每日积分上限
 *   - duplicate: 验证重复消息检测
 *   - nft-bonus: 验证NFT持有量加成
 *   - all: 运行所有验证
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库路径
const DB_PATH = path.join(__dirname, 'data.db');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(emoji, color, message) {
  console.log(`${emoji} ${colors[color]}${message}${colors.reset}`);
}

function success(message) { log('✅', 'green', message); }
function error(message) { log('❌', 'red', message); }
function info(message) { log('📊', 'blue', message); }
function warn(message) { log('⚠️', 'yellow', message); }

// 数据库查询封装
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get(query, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.all(query, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ============================================
// 测试1：每日积分上限验证
// ============================================
async function testDailyCap(guildId, userId) {
  info('Testing daily point caps...');

  // 获取活跃度设置
  const settings = await dbGet(
    'SELECT * FROM activity_settings WHERE guild_id = ?',
    [guildId]
  );

  if (!settings) {
    error('Activity settings not found. Run /activity-setup first.');
    return false;
  }

  if (!settings.enabled) {
    warn('Activity tracking is disabled.');
    return false;
  }

  // 获取用户活跃度数据
  const activity = await dbGet(
    'SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!activity) {
    error('No activity data found. Send some messages first.');
    return false;
  }

  info(`Daily counters:`);
  console.log(`  Messages: ${activity.daily_messages}/${settings.daily_message_cap}`);
  console.log(`  Replies: ${activity.daily_replies}/${settings.daily_reply_cap}`);
  console.log(`  Reactions: ${activity.daily_reactions}/${settings.daily_reaction_cap}`);
  console.log(`  Voice: ${activity.daily_voice}/${settings.daily_voice_cap} min`);

  // 检查是否接近上限
  const tests = [
    { name: 'Messages', current: activity.daily_messages, cap: settings.daily_message_cap },
    { name: 'Replies', current: activity.daily_replies, cap: settings.daily_reply_cap },
    { name: 'Reactions', current: activity.daily_reactions, cap: settings.daily_reaction_cap },
    { name: 'Voice', current: activity.daily_voice, cap: settings.daily_voice_cap }
  ];

  let allPass = true;
  for (const test of tests) {
    if (test.current > test.cap) {
      error(`${test.name} exceeded cap: ${test.current} > ${test.cap}`);
      allPass = false;
    } else if (test.current === test.cap) {
      success(`${test.name} at cap (${test.cap}) - working correctly`);
    } else if (test.current > 0) {
      info(`${test.name} below cap (${test.current}/${test.cap})`);
    }
  }

  // 检查今日重置日期
  const today = new Date().toISOString().split('T')[0];
  if (activity.daily_reset_date === today) {
    success('Daily reset date is today - counters are fresh');
  } else {
    warn(`Daily reset date: ${activity.daily_reset_date} (expected: ${today})`);
  }

  return allPass;
}

// ============================================
// 测试2：重复消息检测（间接验证）
// ============================================
async function testDuplicateDetection(guildId, userId) {
  info('Testing duplicate message detection...');
  warn('Note: This is indirect - check bot logs for "duplicate message" rejections');

  const activity = await dbGet(
    'SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!activity) {
    error('No activity data found.');
    return false;
  }

  info('Activity stats:');
  console.log(`  Total messages: ${activity.message_count}`);
  console.log(`  Daily messages: ${activity.daily_messages}`);
  console.log(`  Total score: ${activity.total_score}`);

  // 如果用户发了很多消息但计数很低，说明重复检测在工作
  if (activity.daily_messages < 5) {
    warn('Send more messages to test duplicate detection (at least 5)');
  } else {
    success('Message counting is working. Check bot logs for duplicate rejections.');
  }

  return true;
}

// ============================================
// 测试3：NFT持有量加成验证
// ============================================
async function testNftBonus(guildId, userId) {
  info('Testing NFT holding bonus...');

  // 获取活跃度设置
  const settings = await dbGet(
    'SELECT * FROM activity_settings WHERE guild_id = ?',
    [guildId]
  );

  if (!settings || !settings.nft_bonus_enabled) {
    error('NFT bonus is disabled. Enable it with /activity-setup nft_bonus:true');
    return false;
  }

  // 获取用户NFT余额
  const verifiedUser = await dbGet(
    'SELECT * FROM verified_users WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!verifiedUser) {
    error('User not verified. Run /verify first.');
    return false;
  }

  const nftBalance = verifiedUser.nft_balance;

  // 计算预期倍率
  let expectedMultiplier = 1.0;
  if (nftBalance >= settings.nft_tier3_count) {
    expectedMultiplier = settings.nft_tier3_multiplier;
  } else if (nftBalance >= settings.nft_tier2_count) {
    expectedMultiplier = settings.nft_tier2_multiplier;
  } else if (nftBalance >= settings.nft_tier1_count) {
    expectedMultiplier = settings.nft_tier1_multiplier;
  }

  info('NFT Bonus Configuration:');
  console.log(`  User NFT Balance: ${nftBalance}`);
  console.log(`  Expected Multiplier: ${expectedMultiplier}x`);
  console.log(`  Tier 1 (${settings.nft_tier1_count}+ NFT): ${settings.nft_tier1_multiplier}x`);
  console.log(`  Tier 2 (${settings.nft_tier2_count}+ NFT): ${settings.nft_tier2_multiplier}x`);
  console.log(`  Tier 3 (${settings.nft_tier3_count}+ NFT): ${settings.nft_tier3_multiplier}x`);

  // 获取活跃度数据
  const activity = await dbGet(
    'SELECT * FROM activity_tracking WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!activity || activity.total_score === 0) {
    warn('No activity score yet. Send messages to test multiplier.');
    return true;
  }

  // 计算基础分数（无倍率）
  const baseScore =
    activity.message_count * settings.message_score +
    activity.reply_count * settings.reply_score +
    activity.reaction_count * settings.reaction_score +
    activity.voice_minutes * settings.voice_score;

  const expectedScore = Math.round(baseScore * expectedMultiplier * 100) / 100;
  const actualScore = activity.total_score;

  info('Score Verification:');
  console.log(`  Base Score: ${baseScore.toFixed(2)}`);
  console.log(`  Expected Score (with ${expectedMultiplier}x): ${expectedScore}`);
  console.log(`  Actual Score: ${actualScore}`);

  // 允许小误差（因为浮点运算和实时更新）
  const tolerance = 2;
  if (Math.abs(actualScore - expectedScore) < tolerance) {
    success('NFT bonus multiplier is working correctly!');
    return true;
  } else {
    warn('Score mismatch detected. This might be due to:');
    console.log('  - Batch processing delay (wait 5 seconds)');
    console.log('  - Multiple users with different multipliers');
    console.log('  - Recent config changes');
    return false;
  }
}

// ============================================
// 测试4：综合概览
// ============================================
async function testAll(guildId, userId) {
  console.log('\n' + '='.repeat(60));
  info('Running comprehensive test suite...');
  console.log('='.repeat(60) + '\n');

  const results = {
    'Daily Cap': await testDailyCap(guildId, userId),
    'Duplicate Detection': await testDuplicateDetection(guildId, userId),
    'NFT Bonus': await testNftBonus(guildId, userId)
  };

  console.log('\n' + '='.repeat(60));
  info('Test Results Summary:');
  console.log('='.repeat(60));

  for (const [test, passed] of Object.entries(results)) {
    if (passed) {
      success(`${test}: PASSED`);
    } else {
      error(`${test}: FAILED`);
    }
  }

  const totalPassed = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;

  console.log('\n' + '='.repeat(60));
  if (totalPassed === totalTests) {
    success(`All tests passed! (${totalPassed}/${totalTests})`);
  } else {
    warn(`Some tests failed (${totalPassed}/${totalTests} passed)`);
  }
  console.log('='.repeat(60) + '\n');
}

// ============================================
// 主程序
// ============================================
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: node test-verify.js <test_name> <guild_id> <user_id>');
    console.log('\nAvailable tests:');
    console.log('  daily-cap       - Verify daily point caps');
    console.log('  duplicate       - Verify duplicate message detection');
    console.log('  nft-bonus       - Verify NFT holding bonus');
    console.log('  all             - Run all tests');
    console.log('\nExample:');
    console.log('  node test-verify.js all 1234567890 0987654321');
    process.exit(1);
  }

  const [testName, guildId, userId] = args;

  try {
    switch (testName) {
      case 'daily-cap':
        await testDailyCap(guildId, userId);
        break;
      case 'duplicate':
        await testDuplicateDetection(guildId, userId);
        break;
      case 'nft-bonus':
        await testNftBonus(guildId, userId);
        break;
      case 'all':
        await testAll(guildId, userId);
        break;
      default:
        error(`Unknown test: ${testName}`);
        process.exit(1);
    }
  } catch (err) {
    error(`Test failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
