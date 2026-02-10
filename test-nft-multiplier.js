const sqlite3 = require('sqlite3').verbose();

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./data.db');
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Simulate getNftMultiplier function
async function testNftMultiplier(guildId, userId, settings) {
  if (!settings.nft_bonus_enabled) {
    console.log('NFT bonus is DISABLED');
    return 1.0;
  }

  const verifiedUser = await dbGet(
    'SELECT * FROM verified_users WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!verifiedUser) {
    console.log('User is NOT VERIFIED');
    return 1.0;
  }

  const nftBalance = verifiedUser.nft_balance || 0;
  console.log('NFT Balance:', nftBalance);
  console.log('Checking tiers...');
  console.log('  Tier3: count=' + settings.nft_tier3_count + ', multiplier=' + settings.nft_tier3_multiplier);
  console.log('  Tier2: count=' + settings.nft_tier2_count + ', multiplier=' + settings.nft_tier2_multiplier);
  console.log('  Tier1: count=' + settings.nft_tier1_count + ', multiplier=' + settings.nft_tier1_multiplier);

  if (nftBalance >= settings.nft_tier3_count) {
    console.log('→ User qualifies for TIER 3');
    return settings.nft_tier3_multiplier || 1.5;
  } else if (nftBalance >= settings.nft_tier2_count) {
    console.log('→ User qualifies for TIER 2');
    return settings.nft_tier2_multiplier || 1.2;
  } else if (nftBalance >= settings.nft_tier1_count) {
    console.log('→ User qualifies for TIER 1');
    return settings.nft_tier1_multiplier || 1.0;
  }

  return 1.0;
}

(async () => {
  const settings = await dbGet('SELECT * FROM activity_settings WHERE guild_id = ?', ['YOUR_GUILD_ID']);
  console.log('Settings nft_bonus_enabled:', settings.nft_bonus_enabled, '\n');

  const multiplier = await testNftMultiplier('YOUR_GUILD_ID', 'YOUR_USER_ID', settings);
  console.log('\n✅ Final multiplier:', multiplier);
})();
