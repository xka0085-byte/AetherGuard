/**
 * 文件名：checkNFT.js
 * 用途：NFT 验证模块（多链支持 - Ethereum, Polygon, Base）
 *
 * 测试方法：
 * 1. 获取一个已知持有 NFT 的钱包地址
 * 2. 运行 /verify 命令输入该地址
 * 3. 应该显示 NFT 数量
 *
 * 支持的链：
 * - Ethereum Mainnet
 * - Polygon (MATIC)
 * - Base (Coinbase L2)
 */

const { Alchemy, Network } = require('alchemy-sdk');
const NodeCache = require('node-cache');
const config = require('../config');

// 缓存验证结果 24 小时
const cache = new NodeCache({ stdTTL: 86400 });

// Alchemy Network 映射
const NETWORK_MAP = {
  'ethereum': Network.ETH_MAINNET,
  'polygon': Network.MATIC_MAINNET,
  'base': Network.BASE_MAINNET,
};

// 为每个链创建 Alchemy 实例
const alchemyInstances = {};

/**
 * 获取指定链的 Alchemy 实例
 * @param {string} chain - 链名称 (ethereum, polygon, base)
 * @returns {Alchemy}
 */
function getAlchemyInstance(chain = 'ethereum') {
  const networkKey = chain.toLowerCase();

  if (!alchemyInstances[networkKey]) {
    const network = NETWORK_MAP[networkKey];
    if (!network) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    alchemyInstances[networkKey] = new Alchemy({
      apiKey: config.alchemy.apiKey,
      network: network,
    });
  }

  return alchemyInstances[networkKey];
}

/**
 * 验证以太坊钱包地址格式
 * @param {string} address - 钱包地址
 * @returns {boolean}
 */
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * 检查 NFT 所有权
 * @param {string} walletAddress - 用户钱包地址
 * @param {string} contractAddress - NFT 合约地址
 * @param {number} requiredAmount - 需要的最低 NFT 数量（默认: 1）
 * @param {string} chain - 区块链网络 (ethereum, polygon, base)
 * @returns {Promise<{success: boolean, balance?: number, required?: number, chain?: string, error?: string}>}
 */
async function checkNFTOwnership(walletAddress, contractAddress, requiredAmount = 1, chain = 'ethereum') {
  // 验证钱包地址格式
  if (!isValidAddress(walletAddress)) {
    return {
      success: false,
      error: 'INVALID_ADDRESS',
    };
  }

  // 验证合约地址格式
  if (!isValidAddress(contractAddress)) {
    return {
      success: false,
      error: 'INVALID_CONTRACT',
    };
  }

  // 验证链是否支持
  const normalizedChain = chain.toLowerCase();
  if (!NETWORK_MAP[normalizedChain]) {
    return {
      success: false,
      error: 'UNSUPPORTED_CHAIN',
    };
  }

  // 标准化地址为小写
  const normalizedWallet = walletAddress.toLowerCase();
  const normalizedContract = contractAddress.toLowerCase();

  // 先检查缓存（包含链信息）
  const cacheKey = `${normalizedChain}_${normalizedWallet}_${normalizedContract}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    console.log(`✅ Using cached NFT balance for ${normalizedWallet.slice(0, 10)}... on ${normalizedChain}`);
    return cached;
  }

  // 获取对应链的 Alchemy 实例
  const alchemy = getAlchemyInstance(normalizedChain);

  // 尝试 API 调用并重试
  let lastError;
  const maxRetries = config.alchemy.retryCount;
  const timeout = config.alchemy.timeout;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📊 Checking NFT ownership on ${normalizedChain} (attempt ${attempt}/${maxRetries})...`);

      // 创建超时 Promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      );

      // 调用 Alchemy API
      const nftsPromise = alchemy.nft.getNftsForOwner(normalizedWallet, {
        contractAddresses: [normalizedContract],
      });

      const nfts = await Promise.race([nftsPromise, timeoutPromise]);

      // 获取余额
      const balance = nfts.totalCount || 0;

      const result = {
        success: balance >= requiredAmount,
        balance: balance,
        required: requiredAmount,
        chain: normalizedChain,
      };

      // 缓存成功结果
      cache.set(cacheKey, result);

      console.log(`✅ NFT check complete on ${normalizedChain}: ${balance}/${requiredAmount} NFTs found`);

      return result;
    } catch (error) {
      lastError = error;
      console.log(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        // 指数退避：2^attempt 秒
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Waiting ${backoffMs / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  // 所有重试都失败
  console.error(`❌ All ${maxRetries} attempts failed for ${normalizedWallet.slice(0, 10)}...`);

  return {
    success: false,
    error: lastError.message === 'TIMEOUT' ? 'API_TIMEOUT' : 'API_ERROR',
  };
}

/**
 * 获取钱包拥有的所有指定合约的 NFT
 * @param {string} walletAddress - 用户钱包地址
 * @param {string} contractAddress - NFT 合约地址
 * @param {string} chain - 区块链网络 (ethereum, polygon, base)
 * @returns {Promise<{success: boolean, nfts?: Array, error?: string}>}
 */
async function getNFTsForOwner(walletAddress, contractAddress, chain = 'ethereum') {
  if (!isValidAddress(walletAddress) || !isValidAddress(contractAddress)) {
    return {
      success: false,
      error: 'INVALID_ADDRESS',
    };
  }

  const normalizedChain = chain.toLowerCase();
  if (!NETWORK_MAP[normalizedChain]) {
    return {
      success: false,
      error: 'UNSUPPORTED_CHAIN',
    };
  }

  try {
    const alchemy = getAlchemyInstance(normalizedChain);
    const nfts = await alchemy.nft.getNftsForOwner(walletAddress.toLowerCase(), {
      contractAddresses: [contractAddress.toLowerCase()],
    });

    return {
      success: true,
      nfts: nfts.ownedNfts || [],
      totalCount: nfts.totalCount || 0,
      chain: normalizedChain,
    };
  } catch (error) {
    console.error('❌ Failed to get NFTs:', error.message);
    return {
      success: false,
      error: 'API_ERROR',
    };
  }
}

/**
 * 清除特定钱包/合约的缓存
 * @param {string} walletAddress - 用户钱包地址
 * @param {string} contractAddress - NFT 合约地址
 * @param {string} chain - 区块链网络 (ethereum, polygon, base)
 */
function clearCache(walletAddress, contractAddress, chain = 'ethereum') {
  const cacheKey = `${chain.toLowerCase()}_${walletAddress.toLowerCase()}_${contractAddress.toLowerCase()}`;
  cache.del(cacheKey);
}

/**
 * 清除所有缓存
 */
function clearAllCache() {
  cache.flushAll();
}

/**
 * 获取缓存统计信息
 */
function getCacheStats() {
  return cache.getStats();
}

/**
 * 获取支持的链列表
 * @returns {string[]}
 */
function getSupportedChains() {
  return Object.keys(NETWORK_MAP);
}

module.exports = {
  checkNFTOwnership,
  getNFTsForOwner,
  isValidAddress,
  clearCache,
  clearAllCache,
  getCacheStats,
  getSupportedChains,
};
