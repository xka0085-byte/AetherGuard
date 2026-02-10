/**
 * 查找真实的 Polygon NFT 合约和持有者
 * 运行: node find-polygon-nft.js
 */

require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');

const alchemy = new Alchemy({
    apiKey: process.env.ALCHEMY_API_KEY,
    network: Network.MATIC_MAINNET,
});

/**
 * 检查合约是否是标准NFT
 */
async function checkContract(contractAddress) {
    console.log(`\n检查合约: ${contractAddress}`);

    try {
        const metadata = await alchemy.nft.getContractMetadata(contractAddress);
        console.log(`✅ 合约名称: ${metadata.name}`);
        console.log(`✅ 合约类型: ${metadata.tokenType}`);
        console.log(`✅ 总供应量: ${metadata.totalSupply || 'N/A'}`);
        console.log(`✅ 符号: ${metadata.symbol || 'N/A'}`);
        return true;
    } catch (error) {
        console.log(`❌ 错误: ${error.message}`);
        return false;
    }
}

/**
 * 查找持有指定合约NFT的钱包
 */
async function findOwners(contractAddress, limit = 5) {
    console.log(`\n查找持有者 (最多${limit}个)...`);

    try {
        const owners = await alchemy.nft.getOwnersForContract(contractAddress);
        console.log(`✅ 找到 ${owners.owners.length} 个持有者`);

        const results = [];
        for (let i = 0; i < Math.min(limit, owners.owners.length); i++) {
            const owner = owners.owners[i];
            console.log(`\n持有者 ${i + 1}: ${owner}`);

            // 查询该持有者拥有的NFT数量
            const nfts = await alchemy.nft.getNftsForOwner(owner, {
                contractAddresses: [contractAddress],
            });

            console.log(`  持有数量: ${nfts.totalCount}`);
            results.push({
                address: owner,
                balance: nfts.totalCount,
            });
        }

        return results;
    } catch (error) {
        console.log(`❌ 错误: ${error.message}`);
        return [];
    }
}

/**
 * 推荐的测试合约列表
 */
const RECOMMENDED_CONTRACTS = [
    {
        name: 'Sandbox LAND (Polygon)',
        address: '0x9d305a42A3975Ee4c1C57555BeD5919889DCE63F',
        description: 'The Sandbox 虚拟土地NFT',
    },
    {
        name: 'Aavegotchi',
        address: '0x86935F11C86623deC8a25696E1C19a8659CbF95d',
        description: 'Aavegotchi 游戏NFT',
    },
    {
        name: 'Decentraland Wearables',
        address: '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d',
        description: 'Decentraland 可穿戴设备NFT',
    },
];

async function main() {
    console.log('=== Polygon NFT 合约查找工具 ===\n');

    // 测试推荐的合约
    for (const contract of RECOMMENDED_CONTRACTS) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`测试: ${contract.name}`);
        console.log(`说明: ${contract.description}`);
        console.log(`地址: ${contract.address}`);
        console.log('='.repeat(60));

        const isValid = await checkContract(contract.address);

        if (isValid) {
            const owners = await findOwners(contract.address, 3);

            if (owners.length > 0) {
                console.log(`\n✅ 推荐测试数据:`);
                console.log(`   合约地址: ${contract.address}`);
                console.log(`   持有者地址: ${owners[0].address}`);
                console.log(`   持有数量: ${owners[0].balance}`);
                console.log(`\n你可以使用这些数据测试 /setup 和 /verify 命令`);
                break; // 找到一个有效的就停止
            }
        }

        // 等待1秒，避免API限流
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

main().catch(console.error);
