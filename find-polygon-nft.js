/**
 * Find real Polygon NFT contracts and owners
 * Run: node find-polygon-nft.js
 */

require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');

const alchemy = new Alchemy({
    apiKey: process.env.ALCHEMY_API_KEY,
    network: Network.MATIC_MAINNET,
});

/**
 * Check if the contract is a standard NFT
 */
async function checkContract(contractAddress) {
    console.log(`\nChecking contract: ${contractAddress}`);

    try {
        const metadata = await alchemy.nft.getContractMetadata(contractAddress);
        console.log(`✅ Contract name: ${metadata.name}`);
        console.log(`✅ Token type: ${metadata.tokenType}`);
        console.log(`✅ Total supply: ${metadata.totalSupply || 'N/A'}`);
        console.log(`✅ Symbol: ${metadata.symbol || 'N/A'}`);
        return true;
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        return false;
    }
}

/**
 * Find wallets holding NFTs of the specified contract
 */
async function findOwners(contractAddress, limit = 5) {
    console.log(`\nFinding owners (up to ${limit})...`);

    try {
        const owners = await alchemy.nft.getOwnersForContract(contractAddress);
        console.log(`✅ Found ${owners.owners.length} owners`);

        const results = [];
        for (let i = 0; i < Math.min(limit, owners.owners.length); i++) {
            const owner = owners.owners[i];
            console.log(`\nOwner ${i + 1}: ${owner}`);

            // Query the number of NFTs owned by this holder
            const nfts = await alchemy.nft.getNftsForOwner(owner, {
                contractAddresses: [contractAddress],
            });

            console.log(`  Balance: ${nfts.totalCount}`);
            results.push({
                address: owner,
                balance: nfts.totalCount,
            });
        }

        return results;
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
        return [];
    }
}

/**
 * Recommended test contracts list
 */
const RECOMMENDED_CONTRACTS = [
    {
        name: 'Sandbox LAND (Polygon)',
        address: '0x9d305a42A3975Ee4c1C57555BeD5919889DCE63F',
        description: 'The Sandbox Virtual Land NFT',
    },
    {
        name: 'Aavegotchi',
        address: '0x86935F11C86623deC8a25696E1C19a8659CbF95d',
        description: 'Aavegotchi Game NFT',
    },
    {
        name: 'Decentraland Wearables',
        address: '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d',
        description: 'Decentraland Wearables NFT',
    },
];

async function main() {
    console.log('=== Polygon NFT Contract Finder Tool ===\n');

    // Test recommended contracts
    for (const contract of RECOMMENDED_CONTRACTS) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Test: ${contract.name}`);
        console.log(`Description: ${contract.description}`);
        console.log(`Address: ${contract.address}`);
        console.log('='.repeat(60));

        const isValid = await checkContract(contract.address);

        if (isValid) {
            const owners = await findOwners(contract.address, 3);

            if (owners.length > 0) {
                console.log(`\n✅ Recommended test data:`);
                console.log(`   Contract address: ${contract.address}`);
                console.log(`   Owner address: ${owners[0].address}`);
                console.log(`   Balance: ${owners[0].balance}`);
                console.log(`\nYou can use this data to test /setup and /verify commands`);
                break; // Stop once a valid one is found
            }
        }

        // Wait 1 second to avoid API rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

main().catch(console.error);