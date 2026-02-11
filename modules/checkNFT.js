/**
 * Filename: checkNFT.js
 * Purpose: NFT verification module (multi-chain support - Ethereum, Polygon, Base)
 *
 * Test Method:
 * 1. Get a wallet address known to hold an NFT
 * 2. Run /verify command and enter that address
 * 3. Should show NFT count
 *
 * Supported Chains:
 * - Ethereum Mainnet
 * - Polygon (MATIC)
 * - Base (Coinbase L2)
 */

const { Alchemy, Network } = require('alchemy-sdk');
const NodeCache = require('node-cache');
const config = require('../config');

// Cache verification results for 1 hour (reduced from 24h to limit NFT transfer abuse window)
const cache = new NodeCache({ stdTTL: 3600 });

// Alchemy Network mapping
const NETWORK_MAP = {
  'ethereum': Network.ETH_MAINNET,
  'polygon': Network.MATIC_MAINNET,
  'base': Network.BASE_MAINNET,
};

// Create Alchemy instance for each chain
const alchemyInstances = {};

/**
 * Get Alchemy instance for a specific chain
 * @param {string} chain - Chain name (ethereum, polygon, base)
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
 * Validate Ethereum wallet address format (with EIP-55 checksum when mixed-case)
 * @param {string} address - Wallet address
 * @returns {boolean}
 */
function isValidAddress(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
  // If all lowercase or all uppercase, skip checksum (user may have copy-pasted)
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  // Mixed case: validate EIP-55 checksum using ethers (from alchemy-sdk)
  try {
    const { ethers } = require('ethers');
    const checksummed = ethers.getAddress(address);
    return checksummed === address;
  } catch {
    // If ethers not available or address invalid, accept it (fallback to basic check)
    return true;
  }
}

/**
 * Check NFT ownership
 * @param {string} walletAddress - User wallet address
 * @param {string} contractAddress - NFT contract address
 * @param {number} requiredAmount - Minimum NFT amount required (default: 1)
 * @param {string} chain - Blockchain network (ethereum, polygon, base)
 * @returns {Promise<{success: boolean, balance?: number, required?: number, chain?: string, error?: string}>}
 */
async function checkNFTOwnership(walletAddress, contractAddress, requiredAmount = 1, chain = 'ethereum') {
  // Validate wallet address format
  if (!isValidAddress(walletAddress)) {
    return {
      success: false,
      error: 'INVALID_ADDRESS',
    };
  }

  // Validate contract address format
  if (!isValidAddress(contractAddress)) {
    return {
      success: false,
      error: 'INVALID_CONTRACT',
    };
  }

  // Verify if chain is supported
  const normalizedChain = chain.toLowerCase();
  if (!NETWORK_MAP[normalizedChain]) {
    return {
      success: false,
      error: 'UNSUPPORTED_CHAIN',
    };
  }

  // Normalize addresses to lowercase
  const normalizedWallet = walletAddress.toLowerCase();
  const normalizedContract = contractAddress.toLowerCase();

  // Check cache first (includes chain info)
  const cacheKey = `${normalizedChain}_${normalizedWallet}_${normalizedContract}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    console.log(`✅ Using cached NFT balance for ${normalizedWallet.slice(0, 10)}... on ${normalizedChain}`);
    return cached;
  }

  // Get Alchemy instance for the corresponding chain
  const alchemy = getAlchemyInstance(normalizedChain);

  // Attempt API call and retry
  let lastError;
  const maxRetries = config.alchemy.retryCount;
  const timeout = config.alchemy.timeout;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📊 Checking NFT ownership on ${normalizedChain} (attempt ${attempt}/${maxRetries})...`);

      // Create timeout Promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      );

      // Call Alchemy API
      const nftsPromise = alchemy.nft.getNftsForOwner(normalizedWallet, {
        contractAddresses: [normalizedContract],
      });

      const nfts = await Promise.race([nftsPromise, timeoutPromise]);

      // Get balance
      const balance = nfts.totalCount || 0;

      const result = {
        success: balance >= requiredAmount,
        balance: balance,
        required: requiredAmount,
        chain: normalizedChain,
      };

      // Cache successful result
      cache.set(cacheKey, result);

      console.log(`✅ NFT check complete on ${normalizedChain}: ${balance}/${requiredAmount} NFTs found`);

      return result;
    } catch (error) {
      lastError = error;
      console.log(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        // Exponential backoff: 2^attempt seconds
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Waiting ${backoffMs / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  // All retries failed
  console.error(`❌ All ${maxRetries} attempts failed for ${normalizedWallet.slice(0, 10)}...`);

  return {
    success: false,
    error: lastError.message === 'TIMEOUT' ? 'API_TIMEOUT' : 'API_ERROR',
  };
}

/**
 * Get all NFTs for a specific contract owned by a wallet
 * @param {string} walletAddress - User wallet address
 * @param {string} contractAddress - NFT contract address
 * @param {string} chain - Blockchain network (ethereum, polygon, base)
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
 * Clear cache for a specific wallet/contract
 * @param {string} walletAddress - User wallet address
 * @param {string} contractAddress - NFT contract address
 * @param {string} chain - Blockchain network (ethereum, polygon, base)
 */
function clearCache(walletAddress, contractAddress, chain = 'ethereum') {
  const cacheKey = `${chain.toLowerCase()}_${walletAddress.toLowerCase()}_${contractAddress.toLowerCase()}`;
  cache.del(cacheKey);
}

/**
 * Clear all cache
 */
function clearAllCache() {
  cache.flushAll();
}

/**
 * Get cache statistical information
 */
function getCacheStats() {
  return cache.getStats();
}

/**
 * Get list of supported chains
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