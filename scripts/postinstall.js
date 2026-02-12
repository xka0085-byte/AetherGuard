#!/usr/bin/env node

/**
 * Post-install hook: remind user to run setup if .env is missing
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
    console.log('');
    console.log('='.repeat(50));
    console.log('  Welcome to AetherGuard!');
    console.log('='.repeat(50));
    console.log('');
    console.log('  Run the setup wizard to configure your bot:');
    console.log('');
    console.log('    npm run setup');
    console.log('');
    console.log('  This will guide you through getting your');
    console.log('  Discord token, Alchemy key, and more.');
    console.log('='.repeat(50));
    console.log('');
}
