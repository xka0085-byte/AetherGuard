/**
 * Quick Test Script
 * Verify Discord bot configuration
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log('✅ Bot is online!');
  console.log(`📛 Bot Username: ${client.user.tag}`);
  console.log(`🆔 Bot ID: ${client.user.id}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);

  if (client.guilds.cache.size === 0) {
    console.log('\n⚠️  Bot is not in any servers!');
    console.log('🔗 Invite the bot using this URL:');
    console.log(`https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);
  } else {
    console.log('\n✅ Bot configuration looks good!');
    console.log('Servers:');
    client.guilds.cache.forEach(guild => {
      console.log(`  - ${guild.name} (${guild.memberCount} members)`);
    });
  }

  process.exit(0);
});

client.on('error', (error) => {
  console.error('❌ Bot error:', error);
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Login failed:', err.message);
  if (err.message.includes('token')) {
    console.log('\n⚠️  Please check your DISCORD_TOKEN in .env file');
  } else if (err.message.includes('intents')) {
    console.log('\n⚠️  Please enable required Intents in Discord Developer Portal:');
    console.log('1. Go to: https://discord.com/developers/applications');
    console.log('2. Select your app > Bot tab');
    console.log('3. Enable: Server Members Intent, Message Content Intent');
  }
  process.exit(1);
});
