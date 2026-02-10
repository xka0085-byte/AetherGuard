/**
 * 测试多链 NFT 查询
 * 运行: node test-polygon-nft.js
 */

require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');

const WALLET = '0x258189b344DEf8293aa7aC47b0575AE344D5A830';
const CONTRACT = '0x5E4943373c2198625BD441Ae0629E9E7b4FB4797';

async function testNetwork(networkName, network) {
    console.log(`\n=== 测试 ${networkName} ===`);

    const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY,
        network: network,
    });

    try {
        // 简单测试：获取最新区块
        const blockNumber = await alchemy.core.getBlockNumber();
        console.log(`✅ ${networkName} 已启用 - 当前区块: ${blockNumber}`);
        return true;
    } catch (error) {
        if (error.message.includes('not enabled')) {
            console.log(`❌ ${networkName} 未启用 - 需要在 Alchemy Dashboard 中启用`);
        } else {
            console.log(`❌ ${networkName} 错误: ${error.message}`);
        }
        return false;
    }
}

async function testPolygonNFT() {
    console.log('\n=== 测试 Polygon NFT 查询 ===');
    console.log('钱包:', WALLET);
    console.log('合约:', CONTRACT);

    const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY,
        network: Network.MATIC_MAINNET,
    });

    try {
        // 1. 查询指定合约的 NFT
        console.log('\n1. 查询指定合约的 NFT...');
        const startTime = Date.now();
        const nfts = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase(), {
            contractAddresses: [CONTRACT.toLowerCase()],
        });
        const elapsed = Date.now() - startTime;

        console.log(`   耗时: ${elapsed}ms`);
        console.log(`   找到 NFT 数量: ${nfts.totalCount}`);

        // 2. 查询钱包所有 NFT
        console.log('\n2. 查询钱包所有 NFT...');
        const allNfts = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase());
        console.log(`   钱包总 NFT 数: ${allNfts.totalCount}`);

        // 搜索目标合约
        const targetContract = CONTRACT.toLowerCase();
        const matchingNfts = allNfts.ownedNfts.filter(
            nft => nft.contract.address.toLowerCase() === targetContract
        );
        console.log(`   目标合约 NFT 数: ${matchingNfts.length}`);

        // 搜索类似合约（前6位相同）
        const similarNfts = allNfts.ownedNfts.filter(
            nft => nft.contract.address.toLowerCase().startsWith('0x5e4943')
        );
        if (similarNfts.length > 0) {
            console.log(`   类似合约 (0x5e4943...) NFT 数: ${similarNfts.length}`);
            similarNfts.forEach((nft, i) => {
                console.log(`   ${i + 1}. 合约: ${nft.contract.address}, 名称: ${nft.name || 'N/A'}`);
            });
        }

        if (allNfts.ownedNfts.length > 0) {
            console.log('\n   前10个 NFT:');
            allNfts.ownedNfts.slice(0, 10).forEach((nft, i) => {
                console.log(`   ${i + 1}. 合约: ${nft.contract.address}`);
                console.log(`      名称: ${nft.name || nft.title || 'N/A'}, Token ID: ${nft.tokenId}`);
            });
        }

        // 3. 检查合约信息
        console.log('\n3. 查询合约信息...');
        try {
            const contractMeta = await alchemy.nft.getContractMetadata(CONTRACT);
            console.log(`   合约名称: ${contractMeta.name}`);
            console.log(`   合约类型: ${contractMeta.tokenType}`);
            console.log(`   总供应量: ${contractMeta.totalSupply}`);
        } catch (e) {
            console.log(`   ❌ 无法获取合约信息: ${e.message}`);
        }

        // 4. 尝试用 ERC-1155 方式查询
        console.log('\n4. 尝试 ERC-1155 查询...');
        try {
            const balance = await alchemy.nft.getNftsForOwner(WALLET.toLowerCase(), {
                contractAddresses: [CONTRACT.toLowerCase()],
                omitMetadata: true,
            });
            console.log(`   ERC-1155 查询结果: ${balance.totalCount} NFTs`);
        } catch (e) {
            console.log(`   ❌ ERC-1155 查询失败: ${e.message}`);
        }

        return nfts.totalCount;
    } catch (error) {
        console.error('❌ 错误:', error.message);
        return 0;
    }
}

async function main() {
    console.log('=== Alchemy 网络启用状态检查 ===');
    console.log('API Key:', process.env.ALCHEMY_API_KEY ? '已配置' : '未配置');

    await testNetwork('Ethereum Mainnet', Network.ETH_MAINNET);
    await testNetwork('Polygon (MATIC)', Network.MATIC_MAINNET);
    await testNetwork('Base', Network.BASE_MAINNET);

    // 测试 Polygon NFT 查询
    await testPolygonNFT();
}

main();
