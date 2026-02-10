-- ============================================================
-- Discord NFT Bot - 简化数据库Schema (SQLite)
-- ============================================================

-- 表1：社区配置
-- 存储每个Discord服务器的NFT验证配置
CREATE TABLE IF NOT EXISTS communities (
  guild_id TEXT PRIMARY KEY,              -- Discord服务器ID
  nft_contract_address TEXT NOT NULL,     -- NFT合约地址
  chain TEXT DEFAULT 'ethereum',          -- 区块链网络 (ethereum, polygon, base)
  required_amount INTEGER DEFAULT 1,       -- 最低NFT持有数量
  verified_role_id TEXT,                  -- 验证成功后分配的角色ID
  kick_delay_hours INTEGER DEFAULT 24,     -- 移除角色前的延迟时间(小时)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 表2：活跃度配置（独立于NFT验证）
-- 存储每个Discord服务器的活跃度追踪配置
CREATE TABLE IF NOT EXISTS activity_settings (
  guild_id TEXT PRIMARY KEY,              -- Discord服务器ID
  enabled INTEGER DEFAULT 0,               -- 是否启用活跃度追踪 (1=是, 0=否)
  message_score REAL DEFAULT 1.0,          -- 发消息得分
  reply_score REAL DEFAULT 2.0,            -- 回复得分
  reaction_score REAL DEFAULT 0.5,         -- 表情反应得分
  voice_score REAL DEFAULT 0.1,            -- 语音时长得分(每分钟)
  -- 每日积分上限（功能1）
  daily_message_cap INTEGER DEFAULT 100,   -- 每日消息计分上限
  daily_reply_cap INTEGER DEFAULT 50,      -- 每日回复计分上限
  daily_reaction_cap INTEGER DEFAULT 50,   -- 每日反应计分上限
  daily_voice_cap INTEGER DEFAULT 120,     -- 每日语音分钟上限
  -- NFT持有量加成（功能3）
  nft_bonus_enabled INTEGER DEFAULT 0,     -- 是否启用NFT持有量加成
  nft_tier1_count INTEGER DEFAULT 1,       -- 第1档：持有数量
  nft_tier1_multiplier REAL DEFAULT 1.0,   -- 第1档：积分倍率
  nft_tier2_count INTEGER DEFAULT 3,       -- 第2档：持有数量
  nft_tier2_multiplier REAL DEFAULT 1.2,   -- 第2档：积分倍率 (20%加成)
  nft_tier3_count INTEGER DEFAULT 5,       -- 第3档：持有数量
  nft_tier3_multiplier REAL DEFAULT 1.5,   -- 第3档：积分倍率 (50%加成)
  tracking_channels TEXT,                  -- 追踪的频道ID列表(JSON数组)
  leaderboard_channel_id TEXT,             -- 排行榜发布频道ID
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 表3：已验证用户
-- 存储通过NFT验证的用户信息
CREATE TABLE IF NOT EXISTS verified_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,                 -- Discord服务器ID
  user_id TEXT NOT NULL,                  -- Discord用户ID
  wallet_address TEXT,                    -- 钱包地址明文（小写，用于定期重新验证）
  wallet_hash TEXT NOT NULL,              -- 钱包地址的SHA-256哈希（历史兼容）
  nft_balance INTEGER DEFAULT 0,          -- NFT持有数量
  verified_at TEXT DEFAULT CURRENT_TIMESTAMP,  -- 首次验证时间
  last_checked TEXT DEFAULT CURRENT_TIMESTAMP, -- 最后检查时间
  UNIQUE(guild_id, user_id)               -- 每个服务器每个用户只能有一条记录
);

-- 表4：活跃度追踪
-- 存储用户在社区的活跃度数据
CREATE TABLE IF NOT EXISTS activity_tracking (
  guild_id TEXT NOT NULL,                 -- Discord服务器ID
  user_id TEXT NOT NULL,                  -- Discord用户ID
  message_count INTEGER DEFAULT 0,        -- 消息数量
  reply_count INTEGER DEFAULT 0,          -- 回复数量
  reaction_count INTEGER DEFAULT 0,       -- 表情反应数量
  voice_minutes INTEGER DEFAULT 0,        -- 语音时长(分钟)
  total_score INTEGER DEFAULT 0,          -- 总活跃度分数
  week_score INTEGER DEFAULT 0,           -- 本周活跃度分数
  -- 每日计数器（功能1：每日积分上限）
  daily_messages INTEGER DEFAULT 0,       -- 今日消息计数
  daily_replies INTEGER DEFAULT 0,        -- 今日回复计数
  daily_reactions INTEGER DEFAULT 0,      -- 今日反应计数
  daily_voice INTEGER DEFAULT 0,          -- 今日语音分钟数
  daily_reset_date TEXT,                  -- 每日计数器重置日期(YYYY-MM-DD)
  last_active TEXT DEFAULT CURRENT_TIMESTAMP, -- 最后活跃时间
  PRIMARY KEY(guild_id, user_id)
);

-- 表5：审计日志
-- 存储管理员操作和安全事件（持久化存储）
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,                 -- Discord服务器ID
  event_type TEXT NOT NULL,               -- 事件类型
  admin_id TEXT,                          -- 操作管理员ID（如有）
  admin_tag TEXT,                         -- 管理员标签（如 Admin#1234）
  target_user_id TEXT,                    -- 目标用户ID（如有）
  details TEXT,                           -- 事件详情（JSON格式）
  ip_info TEXT,                           -- 额外信息（Discord无法获取真实IP）
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 表6：用户行为记录
-- 存储用户行为模式用于安全分析
CREATE TABLE IF NOT EXISTS user_behavior (
  guild_id TEXT NOT NULL,                 -- Discord服务器ID
  user_id TEXT NOT NULL,                  -- Discord用户ID
  first_seen TEXT DEFAULT CURRENT_TIMESTAMP,  -- 首次出现时间
  last_seen TEXT DEFAULT CURRENT_TIMESTAMP,   -- 最后活跃时间
  verify_attempts INTEGER DEFAULT 0,       -- 验证尝试次数
  command_count INTEGER DEFAULT 0,         -- 命令使用次数
  flags TEXT,                              -- 标记列表（JSON数组）
  risk_score INTEGER DEFAULT 0,            -- 风险评分 (0-100)
  notes TEXT,                              -- 备注
  PRIMARY KEY(guild_id, user_id)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_verified_users_guild ON verified_users(guild_id);
CREATE INDEX IF NOT EXISTS idx_verified_users_wallet_hash ON verified_users(wallet_hash);
CREATE INDEX IF NOT EXISTS idx_verified_users_wallet_address ON verified_users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_activity_score ON activity_tracking(guild_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_activity_week_score ON activity_tracking(guild_id, week_score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_guild ON audit_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_behavior_risk ON user_behavior(risk_score DESC);
