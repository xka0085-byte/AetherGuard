# Testing Guide (TESTING.md)

This document provides complete testing steps to ensure all bot functions are working correctly.

---

## 1. Environment Check

### 1.1 Check Node.js Version
```bash
node --version
# Should display v18.x.x or higher
```

### 1.2 Check Dependency Installation
```bash
npm list --depth=0
```

Should display:
- alchemy-sdk
- better-sqlite3
- discord.js
- dotenv
- node-cache
- node-cron

### 1.3 Check Environment Variables
```bash
# Windows PowerShell
Get-Content .env

# Or manually check .env file contains:
# - DISCORD_TOKEN
# - DISCORD_CLIENT_ID
# - ALCHEMY_API_KEY
```

---

## 2. Startup Test

### 2.1 Start Bot
```bash
npm start
```

### 2.2 Expected Output
```
✅ Configuration validated successfully
✅ Database initialized: ./data.db
✅ Activity tracker initialized (batch interval: 30000ms)
✅ Leaderboard scheduler initialized (Monday 00:00 UTC)
📝 Registering slash commands...
✅ Slash commands registered (5 commands)
✅ Bot logged in as YourBot#1234
📊 Serving X guilds
🚀 Bot is ready!
```

### 2.3 Check Database File
After startup, `data.db` file should be generated in the project directory.

---

## 3. Command Testing

### 3.1 /help Command
**Test Steps:**
1. Type `/help` in Discord server
2. Press Enter to execute

**Expected Results:**
- Display help document Embed
- Contains 5 command descriptions
- Contains scoring rules
- Message is ephemeral (only you can see it)

---

### 3.2 /setup Command (Administrator)
**Test Steps:**
1. Ensure you have administrator permissions
2. Type `/setup`
3. Fill in parameters:
   - `contract_address`: Valid NFT contract address (e.g. `0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D`)
   - `verified_role`: Select a role
   - `required_amount`: 1 (optional)
   - `activity_enabled`: True (optional)
   - `leaderboard_channel`: Select a channel (optional)

**Expected Results:**
- Display green success Embed
- Display configured contract address, role, amount, etc.

**Error Testing:**
- Enter invalid contract address (e.g. `abc123`)
- Should display "Invalid wallet address" error

---

### 3.3 /verify Command
**Test Steps:**
1. Type `/verify`
2. Modal pops up, enter wallet address

**Test Scenario A - Successful Verification:**
- Enter a wallet address that holds the NFT
- Expected: Display success message, automatically assign role

**Test Scenario B - Verification Failed:**
- Enter a wallet address that does not hold the NFT (e.g. `0x0000000000000000000000000000000000000000`)
- Expected: Display "NFT not found" error

**Test Scenario C - Invalid Address:**
- Enter a malformed address (e.g. `not_a_wallet`)
- Expected: Display "Invalid wallet address" error

---

### 3.4 /my-activity Command
**Test Steps:**
1. Type `/my-activity`

**Scenario A - With Activity Data:**
- Send a few messages in the server first
- Wait 30 seconds (batch processing interval)
- Execute command
- Expected: Display message count, points, rank

**Scenario B - No Data:**
- Execute in new server or as new user
- Expected: Display "No activity records yet"

---

### 3.5 /leaderboard Command
**Test Steps:**
1. Type `/leaderboard`

**Expected Results:**
- Display this week's activity leaderboard
- Includes top 10 users
- Display medal icons (gold, silver, bronze)
- Display message count, reply count, voice duration for each user

---

## 4. Activity Tracking Test

### 4.1 Message Tracking
1. Send a message (at least 3 characters)
2. Wait 30 seconds
3. Execute `/my-activity`
4. Check if message count increased

### 4.2 Reply Tracking
1. Reply to someone's message
2. Wait 30 seconds
3. Execute `/my-activity`
4. Check if reply count increased

### 4.3 Reaction Tracking
1. Add an emoji reaction to someone's message
2. Wait 30 seconds
3. Execute `/my-activity`
4. Check if reaction count increased

### 4.4 Voice Tracking
1. Join a voice channel
2. Stay for at least 1 minute
3. Leave the voice channel
4. Execute `/my-activity`
5. Check if voice duration increased

### 4.5 Anti-Spam Test
1. Send multiple messages in rapid succession (within 10 seconds)
2. Only the first one should be scored
3. Wait 10 seconds and send another one
4. This one should be scored

---

## 5. Command Cooldown Test

**Test Steps:**
1. Execute any command (e.g. `/help`)
2. Execute another command immediately
3. Should display "Please wait X seconds before using command again"
4. Wait 5 seconds and try again
5. Command should execute normally

---

## 6. New Member Verification Test

**Test Steps:**
1. Join the server with an alt account
2. Should receive a DM from the bot
3. DM contains a "Verify NFT Ownership" button
4. Click the button, enter wallet address
5. Display success or failure based on NFT holdings

---

## 7. Re-verification Test

**Description:** The bot checks for expired verifications every hour (not checked for 24 hours).

**Manual Test Method:**
1. Complete a verification
2. Manually modify the `last_checked` time in the database to 25 hours ago
3. Wait for the hourly check to trigger
4. Or restart the bot and wait for the initial check

---

## 8. Database Verification

### 8.1 Check Table Structure
```bash
# Using SQLite command line tool
sqlite3 data.db ".tables"
# Should display: activity_tracking  communities  verified_users
```

### 8.2 Check Community Configuration
```bash
sqlite3 data.db "SELECT * FROM communities;"
```

### 8.3 Check Verified Users
```bash
sqlite3 data.db "SELECT * FROM verified_users;"
```

### 8.4 Check Activity Data
```bash
sqlite3 data.db "SELECT * FROM activity_tracking ORDER BY total_score DESC LIMIT 10;"
```

---

## 9. Error Handling Test

### 9.1 Alchemy API Error
- Use an invalid API Key
- Expected: Display API error message

### 9.2 Database Error
- Delete data.db file
- Restart the bot
- Expected: Automatically recreate the database

### 9.3 Discord API Error
- Use an invalid Token
- Expected: Display login failure error on startup

---

## 10. Performance Test

### 10.1 Batch Activity Processing
1. Send messages rapidly in multiple channels
2. Check console logs
3. Should display "Processed X activity events"

### 10.2 Cache Efficiency
1. Verify the same wallet twice in a row
2. Second time should use cache (console shows "Using cached NFT balance")

---

## Test Checklist Summary

- [ ] Environment check passed
- [ ] Bot started successfully
- [ ] /help command normal
- [ ] /setup command normal (Administrator)
- [ ] /verify command normal
- [ ] /my-activity command normal
- [ ] /leaderboard command normal
- [ ] Message activity tracking normal
- [ ] Reply activity tracking normal
- [ ] Reaction activity tracking normal
- [ ] Voice activity tracking normal
- [ ] Command cooldown normal (5 seconds)
- [ ] New members automatically sent verification DM
- [ ] Error messages are friendly

---

## Troubleshooting

| Problem | Possible Cause | Solution |
|------|----------|----------|
| Commands not showing | Discord cache | Wait a few minutes or re-invite the bot |
| Database error | better-sqlite3 not installed correctly | Run `npm rebuild better-sqlite3` |
| NFT verification timeout | Alchemy API problem | Check API Key, try again later |
| Activity not updating | Batch interval not reached | Wait 30 seconds and check |
| DM sending failed | User privacy settings | User needs to enable server member DMs |