# 测试指南 (TESTING.md)

本文档提供完整的测试步骤，确保机器人各功能正常工作。

---

## 1. 环境检查

### 1.1 检查 Node.js 版本
```bash
node --version
# 应该显示 v18.x.x 或更高
```

### 1.2 检查依赖安装
```bash
npm list --depth=0
```

应该显示：
- alchemy-sdk
- better-sqlite3
- discord.js
- dotenv
- node-cache
- node-cron

### 1.3 检查环境变量
```bash
# Windows PowerShell
Get-Content .env

# 或手动检查 .env 文件包含：
# - DISCORD_TOKEN
# - DISCORD_CLIENT_ID
# - ALCHEMY_API_KEY
```

---

## 2. 启动测试

### 2.1 启动机器人
```bash
npm start
```

### 2.2 预期输出
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

### 2.3 检查数据库文件
启动后应该在项目目录生成 `data.db` 文件。

---

## 3. 命令测试

### 3.1 /help 命令
**测试步骤：**
1. 在 Discord 服务器输入 `/help`
2. 按回车执行

**预期结果：**
- 显示帮助文档 Embed
- 包含 5 个命令说明
- 包含积分规则
- 消息为私密（只有你能看到）

---

### 3.2 /setup 命令（管理员）
**测试步骤：**
1. 确保你有管理员权限
2. 输入 `/setup`
3. 填写参数：
   - `contract_address`: 有效的 NFT 合约地址（如 `0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D`）
   - `verified_role`: 选择一个角色
   - `required_amount`: 1（可选）
   - `activity_enabled`: True（可选）
   - `leaderboard_channel`: 选择频道（可选）

**预期结果：**
- 显示绿色成功 Embed
- 显示配置的合约地址、角色、数量等信息

**错误测试：**
- 输入无效合约地址（如 `abc123`）
- 应该显示「无效的钱包地址」错误

---

### 3.3 /verify 命令
**测试步骤：**
1. 输入 `/verify`
2. 弹出模态框，输入钱包地址

**测试场景 A - 成功验证：**
- 输入持有该 NFT 的钱包地址
- 预期：显示成功消息，自动分配角色

**测试场景 B - 验证失败：**
- 输入不持有 NFT 的钱包地址（如 `0x0000000000000000000000000000000000000000`）
- 预期：显示「未找到 NFT」错误

**测试场景 C - 无效地址：**
- 输入格式错误的地址（如 `not_a_wallet`）
- 预期：显示「无效的钱包地址」错误

---

### 3.4 /my-activity 命令
**测试步骤：**
1. 输入 `/my-activity`

**场景 A - 有活跃度数据：**
- 先在服务器发送几条消息
- 等待 30 秒（批量处理间隔）
- 执行命令
- 预期：显示消息数、积分、排名

**场景 B - 无数据：**
- 在新服务器或新用户执行
- 预期：显示「您还没有活跃度记录」

---

### 3.5 /leaderboard 命令
**测试步骤：**
1. 输入 `/leaderboard`

**预期结果：**
- 显示本周活跃度排行榜
- 包含前 10 名用户
- 显示奖牌图标（金银铜）
- 显示各用户的消息数、回复数、语音时长

---

## 4. 活跃度追踪测试

### 4.1 消息追踪
1. 发送一条消息（至少 3 个字符）
2. 等待 30 秒
3. 执行 `/my-activity`
4. 检查消息数是否增加

### 4.2 回复追踪
1. 回复他人的消息
2. 等待 30 秒
3. 执行 `/my-activity`
4. 检查回复数是否增加

### 4.3 反应追踪
1. 对他人的消息添加表情反应
2. 等待 30 秒
3. 执行 `/my-activity`
4. 检查反应数是否增加

### 4.4 语音追踪
1. 加入语音频道
2. 停留至少 1 分钟
3. 离开语音频道
4. 执行 `/my-activity`
5. 检查语音时长是否增加

### 4.5 防垃圾测试
1. 快速连续发送多条消息（10秒内）
2. 只有第一条应该计分
3. 等待 10 秒后再发一条
4. 这条应该计分

---

## 5. 命令冷却测试

**测试步骤：**
1. 执行任意命令（如 `/help`）
2. 立即再次执行另一个命令
3. 应该显示「请等待 X 秒后再使用命令」
4. 等待 5 秒后再试
5. 命令应该正常执行

---

## 6. 新成员验证测试

**测试步骤：**
1. 使用小号加入服务器
2. 应该收到机器人的私信
3. 私信包含「验证 NFT 所有权」按钮
4. 点击按钮，输入钱包地址
5. 根据 NFT 持有情况显示成功或失败

---

## 7. 重新验证测试

**说明：** 机器人每小时检查一次过期验证（24小时未检查）。

**手动测试方法：**
1. 完成一次验证
2. 手动修改数据库中的 `last_checked` 时间为 25 小时前
3. 等待整点触发检查
4. 或重启机器人等待首次检查

---

## 8. 数据库验证

### 8.1 检查表结构
```bash
# 使用 SQLite 命令行工具
sqlite3 data.db ".tables"
# 应该显示：activity_tracking  communities  verified_users
```

### 8.2 检查社区配置
```bash
sqlite3 data.db "SELECT * FROM communities;"
```

### 8.3 检查已验证用户
```bash
sqlite3 data.db "SELECT * FROM verified_users;"
```

### 8.4 检查活跃度数据
```bash
sqlite3 data.db "SELECT * FROM activity_tracking ORDER BY total_score DESC LIMIT 10;"
```

---

## 9. 错误处理测试

### 9.1 Alchemy API 错误
- 使用无效的 API Key
- 预期：显示 API 错误消息

### 9.2 数据库错误
- 删除 data.db 文件
- 重启机器人
- 预期：自动重新创建数据库

### 9.3 Discord API 错误
- 使用无效的 Token
- 预期：启动时显示登录失败错误

---

## 10. 性能测试

### 10.1 批量活跃度处理
1. 在多个频道快速发送消息
2. 检查控制台日志
3. 应该显示「Processed X activity events」

### 10.2 缓存效率
1. 同一钱包连续验证两次
2. 第二次应该使用缓存（控制台显示 "Using cached NFT balance"）

---

## 测试清单总结

- [ ] 环境检查通过
- [ ] 机器人成功启动
- [ ] /help 命令正常
- [ ] /setup 命令正常（管理员）
- [ ] /verify 命令正常
- [ ] /my-activity 命令正常
- [ ] /leaderboard 命令正常
- [ ] 消息活跃度追踪正常
- [ ] 回复活跃度追踪正常
- [ ] 反应活跃度追踪正常
- [ ] 语音活跃度追踪正常
- [ ] 命令冷却正常（5秒）
- [ ] 新成员自动发送验证私信
- [ ] 错误消息友好

---

## 常见问题排查

| 问题 | 可能原因 | 解决方法 |
|------|----------|----------|
| 命令不显示 | Discord 缓存 | 等待几分钟或重新邀请机器人 |
| 数据库错误 | better-sqlite3 未正确安装 | 运行 `npm rebuild better-sqlite3` |
| NFT 验证超时 | Alchemy API 问题 | 检查 API Key，稍后重试 |
| 活跃度不更新 | 批量间隔未到 | 等待 30 秒后检查 |
| 私信发送失败 | 用户隐私设置 | 用户需开启服务器成员私信 |
