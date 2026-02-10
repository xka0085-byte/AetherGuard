/**
 * Force refresh Discord slash commands
 * Run this if commands don't show up in Discord
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  {
    name: 'setup',
    description: 'Configure NFT verification for this server',
  },
  {
    name: 'verify',
    description: 'Verify your NFT ownership to get the verified role',
  },
  {
    name: 'check',
    description: 'Check verification status',
    options: [
      {
        name: 'user',
        description: 'User to check (optional)',
        type: 6, // USER type
        required: false,
      },
    ],
  },
  {
    name: 'activity-setup',
    description: 'Configure activity tracking for this server',
  },
  {
    name: 'my-activity',
    description: 'View your activity statistics',
  },
  {
    name: 'activity-stats',
    description: 'View server activity statistics',
  },
  {
    name: 'leaderboard',
    description: 'View the activity leaderboard',
  },
  {
    name: 'feedback',
    description: 'Send feedback to the developers',
  },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Refreshing slash commands...');

    // Delete all existing global commands first
    const existingCommands = await rest.get(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
    );

    console.log(`📋 Found ${existingCommands.length} existing command(s)`);

    for (const cmd of existingCommands) {
      console.log(`🗑️  Deleting: ${cmd.name}`);
      await rest.delete(
        Routes.applicationCommand(process.env.DISCORD_CLIENT_ID, cmd.id)
      );
    }

    // Register fresh commands
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log('✅ Commands refreshed successfully!');
    console.log('⏳ Wait 1-2 minutes, then press Ctrl+R in Discord to reload');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error refreshing commands:', error);
    process.exit(1);
  }
})();
