-- ============================================================
-- Discord NFT Bot - Simplified Database Schema (SQLite)
-- ============================================================

-- Table 1: Community Configuration
-- Store NFT verification configuration for each Discord guild
CREATE TABLE IF NOT EXISTS communities (
  guild_id TEXT PRIMARY KEY,              -- Discord Guild ID
  nft_contract_address TEXT NOT NULL,     -- NFT contract address
  chain TEXT DEFAULT 'ethereum',          -- Blockchain network (ethereum, polygon, base)
  required_amount INTEGER DEFAULT 1,       -- Minimum NFT amount required
  verified_role_id TEXT,                  -- Role ID to assign after successful verification
  kick_delay_hours INTEGER DEFAULT 24,     -- Delay time before removing role (hours)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 2: Activity Settings (Independent of NFT verification)
-- Store activity tracking configuration for each Discord guild
CREATE TABLE IF NOT EXISTS activity_settings (
  guild_id TEXT PRIMARY KEY,              -- Discord Guild ID
  enabled INTEGER DEFAULT 0,               -- Whether to enable activity tracking (1=Yes, 0=No)
  message_score REAL DEFAULT 1.0,          -- Points for sending a message
  reply_score REAL DEFAULT 2.0,            -- Points for replying
  reaction_score REAL DEFAULT 0.5,         -- Points for emoji reaction
  voice_score REAL DEFAULT 0.1,            -- Points for voice duration (per minute)
  -- Daily point caps (Feature 1)
  daily_message_cap INTEGER DEFAULT 100,   -- Daily message point cap
  daily_reply_cap INTEGER DEFAULT 50,      -- Daily reply point cap
  daily_reaction_cap INTEGER DEFAULT 50,   -- Daily reaction point cap
  daily_voice_cap INTEGER DEFAULT 120,     -- Daily voice minutes cap
  -- NFT holding bonus (Feature 3)
  nft_bonus_enabled INTEGER DEFAULT 0,     -- Whether to enable NFT holding bonus
  nft_tier1_count INTEGER DEFAULT 1,       -- Tier 1: Holding count
  nft_tier1_multiplier REAL DEFAULT 1.0,   -- Tier 1: Point multiplier
  nft_tier2_count INTEGER DEFAULT 3,       -- Tier 2: Holding count
  nft_tier2_multiplier REAL DEFAULT 1.2,   -- Tier 2: Point multiplier (20% bonus)
  nft_tier3_count INTEGER DEFAULT 5,       -- Tier 3: Holding count
  nft_tier3_multiplier REAL DEFAULT 1.5,   -- Tier 3: Point multiplier (50% bonus)
  tracking_channels TEXT,                  -- List of tracked channel IDs (JSON array)
  leaderboard_channel_id TEXT,             -- Leaderboard posting channel ID
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: Verified Users
-- Store information of users who passed NFT verification
CREATE TABLE IF NOT EXISTS verified_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,                 -- Discord Guild ID
  user_id TEXT NOT NULL,                  -- Discord User ID
  wallet_address TEXT,                    -- Plain text wallet address (lowercase, used for periodic re-verification)
  wallet_hash TEXT NOT NULL,              -- SHA-256 hash of wallet address (historical compatibility)
  nft_balance INTEGER DEFAULT 0,          -- NFT balance
  verified_at TEXT DEFAULT CURRENT_TIMESTAMP,  -- Initial verification time
  last_checked TEXT DEFAULT CURRENT_TIMESTAMP, -- Last check time
  UNIQUE(guild_id, user_id)               -- Each user can only have one record per guild
);

-- Table 4: Activity Tracking
-- Store user activity data in the community
CREATE TABLE IF NOT EXISTS activity_tracking (
  guild_id TEXT NOT NULL,                 -- Discord Guild ID
  user_id TEXT NOT NULL,                  -- Discord User ID
  message_count INTEGER DEFAULT 0,        -- Message count
  reply_count INTEGER DEFAULT 0,          -- Reply count
  reaction_count INTEGER DEFAULT 0,       -- Emoji reaction count
  voice_minutes INTEGER DEFAULT 0,        -- Voice duration (minutes)
  total_score INTEGER DEFAULT 0,          -- Total activity score
  week_score INTEGER DEFAULT 0,           -- Weekly activity score
  -- Daily counters (Feature 1: Daily point caps)
  daily_messages INTEGER DEFAULT 0,       -- Today's message count
  daily_replies INTEGER DEFAULT 0,        -- Today's reply count
  daily_reactions INTEGER DEFAULT 0,      -- Today's reaction count
  daily_voice INTEGER DEFAULT 0,          -- Today's voice minutes
  daily_reset_date TEXT,                  -- Daily counter reset date (YYYY-MM-DD)
  last_active TEXT DEFAULT CURRENT_TIMESTAMP, -- Last active time
  PRIMARY KEY(guild_id, user_id)
);

-- Table 5: Audit Logs
-- Store administrator operations and security events (persistent storage)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,                 -- Discord Guild ID
  event_type TEXT NOT NULL,               -- Event type
  admin_id TEXT,                          -- Admin ID (if any)
  admin_tag TEXT,                         -- Admin tag (e.g. Admin#1234)
  target_user_id TEXT,                    -- Target user ID (if any)
  details TEXT,                           -- Event details (JSON format)
  ip_info TEXT,                           -- Extra info (Discord cannot get real IP)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 6: User Behavior Records
-- Store user behavior patterns for security analysis
CREATE TABLE IF NOT EXISTS user_behavior (
  guild_id TEXT NOT NULL,                 -- Discord Guild ID
  user_id TEXT NOT NULL,                  -- Discord User ID
  first_seen TEXT DEFAULT CURRENT_TIMESTAMP,  -- First seen time
  last_seen TEXT DEFAULT CURRENT_TIMESTAMP,   -- Last active time
  verify_attempts INTEGER DEFAULT 0,       -- Verification attempt count
  command_count INTEGER DEFAULT 0,         -- Command usage count
  flags TEXT,                              -- Flags list (JSON array)
  risk_score INTEGER DEFAULT 0,            -- Risk score (0-100)
  notes TEXT,                              -- Notes
  PRIMARY KEY(guild_id, user_id)
);

-- Create indexes to improve query performance
CREATE INDEX IF NOT EXISTS idx_verified_users_guild ON verified_users(guild_id);
CREATE INDEX IF NOT EXISTS idx_verified_users_wallet_hash ON verified_users(wallet_hash);
CREATE INDEX IF NOT EXISTS idx_verified_users_wallet_address ON verified_users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_activity_score ON activity_tracking(guild_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_activity_week_score ON activity_tracking(guild_id, week_score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_guild ON audit_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_behavior_risk ON user_behavior(risk_score DESC);