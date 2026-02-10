/**
 * Test multi-chain NFT query
 * Run: node test-polygon-nft.js
 */

require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');

const WALLET = '0x258189b344DEf8293aa7aC47b0575AE344D5A830';
const CONTRACT = '0x5E4943373c2198625BD441Ae0629E9E7b4FB4797';

async function testNetwork(networkName, network) {
    console.log(`\n=== Testing ${networkName} ===`);

    const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY,
        network: network,
    });

    try {
        // Simple test: get the latest block
        const blockNumber = await alchemy.core.getBlockNumber();
        console.log(`✅ ${networkName} Enabled - Current block: ${blockNumber}`);
        return true;
    } catch (error) {
        if (error.message.includes('not enabled')) {
            console.log(`❌ ${networkName} Not enabled - Need to enable in Alchemy Dashboard`);
        } else {
            console.log(`❌ ${networkName} Error: ${error.message}`);
        }
        return false;
    }
}

async function testPolygonNFT() {
    console.log('\n=== Testing Polygon NFT Query ===');
    console.log('Wallet:', WALLET);
    console.log('Contract:', CONTRACT);

    const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY,
        network: Network.MATIC_MAINNET,
    });

    try {
        // 1. Query NFTs of the specified contract
        console.log('\n1. Querying NFTs for the specified contract...');
        const startTime = Date.now();
        const nfts = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase(), {
            contractAddresses: [CONTRACT.toLowerCase()],
        });
        const elapsed = Date.now() - startTime;

        console.log(`   Elapsed time: ${elapsed}ms`);
        console.log(`   NFT count found: ${nfts.totalCount}`);

        // 2. Query all NFTs in the wallet
        console.log('\n2. Querying all NFTs in the wallet...');
        const allNfts = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase());
        console.log(`   Total wallet NFT count: ${allNfts.totalCount}`);

        // Search for target contract
        const targetContract = CONTRACT.toLowerCase();
        const matchingNfts = allNfts.ownedNfts.filter(
            nft => nft.contract.address.toLowerCase() === targetContract
        );
        console.log(`   Target contract NFT count: ${matchingNfts.length}`);

        // Search for similar contracts (first 6 characters match)
        const similarNfts = allNfts.ownedNfts.filter(
            nft => nft.contract.address.toLowerCase().startsWith('0x5e4943')
        );
        if (similarNfts.length > 0) {
            console.log(`   Similar contracts (0x5e4943...) NFT count: ${similarNfts.length}`);
            similarNfts.forEach((nft, i) => {
                console.log(`   ${i + 1}. Contract: ${nft.contract.address}, Name: ${nft.name || 'N/A'}`);
            });
        }

        if (allNfts.ownedNfts.length > 0) {
            console.log('\n   Top 10 NFTs:');
            allNfts.ownedNfts.slice(0, 10).forEach((nft, i) => {
                console.log(`   ${i + 1}. Contract: ${nft.contract.address}`);
                console.log(`      Name: ${nft.name || nft.title || 'N/A'}, Token ID: ${nft.tokenId}`);
            });
        }

        // 3. Check contract information
        console.log('\n3. Querying contract information...');
        try {
            const contractMeta = await alchemy.nft.getContractMetadata(CONTRACT);
            console.log(`   Contract name: ${contractMeta.name}`);
            console.log(`   Token type: ${contractMeta.tokenType}`);
            console.log(`   Total supply: ${contractMeta.totalSupply}`);
        } catch (e) {
            console.log(`   ❌ Unable to get contract info: ${e.message}`);
        }

        // 4. Try querying using ERC-1155 method
        console.log('\n4. Trying ERC-1155 query...');
        try {
            const balance = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase(), {
                contractAddresses: [CONTRACT.toLowerCase()],
                omitMetadata: true,
            });
            console.log(`   ERC-1155 query result: ${balance.totalCount} NFTs`);
        } catch (e) {
            console.log(`   ❌ ERC-1155 query failed: ${e.message}`);
        }

        return nfts.totalCount;
    } catch (error) {
        console.error('❌ Error:', error.message);
        return 0;
    }
}

async function main() {
    console.log('=== Alchemy Network Enabled Status Check ===');
    console.log('API Key:', process.env.ALCHEMY_API_KEY ? 'Configured' : 'Not configured');

    await testNetwork('Ethereum Mainnet', Network.ETH_MAINNET);
    await testNetwork('Polygon (MATIC)', Network.MATIC_MAINNET);
    await testNetwork('Base', Network.BASE_MAINNET);

    // Test Polygon NFT Query
    await testPolygonNFT();
}

main();