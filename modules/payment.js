/**
 * 文件名：payment.js
 * 用途：链上支付验证模块 — 通过 tx hash 验证 ERC-20 Transfer 事件
 *
 * 支持：多链（Ethereum, Polygon, Base）× 多币种（USDC, USDT 等）
 */

const { Alchemy, Network } = require('alchemy-sdk');
const config = require('../config');

// ERC-20 Transfer(address,address,uint256) 事件签名
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const NETWORK_MAP = {
  'ethereum': Network.ETH_MAINNET,
  'polygon': Network.MATIC_MAINNET,
  'base': Network.BASE_MAINNET,
};

const alchemyInstances = {};

function getAlchemyInstance(chain) {
  const key = chain.toLowerCase();
  if (!alchemyInstances[key]) {
    const network = NETWORK_MAP[key];
    if (!network) throw new Error(`Unsupported chain: ${chain}`);
    alchemyInstances[key] = new Alchemy({
      apiKey: config.alchemy.apiKey,
      network,
    });
  }
  return alchemyInstances[key];
}

/**
 * 获取指定链上接受的代币列表
 * @param {string} chain
 * @returns {Array<{symbol:string, contract:string, decimals:number}>}
 */
function getAcceptedTokens(chain) {
  return (config.payments.acceptedTokens || []).filter(
    t => t.chain.toLowerCase() === chain.toLowerCase()
  );
}

/**
 * 获取所有支持支付的链
 * @returns {string[]}
 */
function getSupportedPayChains() {
  const chains = new Set(
    (config.payments.acceptedTokens || []).map(t => t.chain.toLowerCase())
  );
  return [...chains];
}

/**
 * 验证 ERC-20 转账交易（多链多币种）
 * @param {string} txHash - 交易哈希
 * @param {string} chain - 链名称 (ethereum, polygon, base)
 * @returns {Promise<{ok:boolean, error?:string, from?:string, to?:string, amount?:string, token?:string, symbol?:string, chain?:string}>}
 */
async function verifyPayment(txHash, chain) {
  const pay = config.payments;
  if (!pay.enabled) return { ok: false, error: 'PAYMENTS_DISABLED' };
  if (!pay.receiver) return { ok: false, error: 'NO_RECEIVER' };

  chain = chain.toLowerCase();
  if (!NETWORK_MAP[chain]) return { ok: false, error: 'UNSUPPORTED_CHAIN' };

  const tokens = getAcceptedTokens(chain);
  if (tokens.length === 0) return { ok: false, error: 'NO_TOKENS_ON_CHAIN' };

  // 构建 contract → token 的快速查找表
  const tokenMap = {};
  for (const t of tokens) {
    tokenMap[t.contract.toLowerCase()] = t;
  }

  const alchemy = getAlchemyInstance(chain);

  // 1. 获取交易 receipt
  let receipt;
  try {
    receipt = await alchemy.core.getTransactionReceipt(txHash);
  } catch (e) {
    console.error('❌ getTransactionReceipt failed:', e.message);
    return { ok: false, error: 'RPC_ERROR' };
  }

  if (!receipt) return { ok: false, error: 'TX_NOT_FOUND' };
  if (receipt.status !== 1) return { ok: false, error: 'TX_REVERTED' };

  // 2. 检查确认数
  if (pay.minConfirmations > 1) {
    try {
      const currentBlock = await alchemy.core.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;
      if (confirmations < pay.minConfirmations) {
        return { ok: false, error: 'INSUFFICIENT_CONFIRMATIONS' };
      }
    } catch (_) { /* receipt 存在即至少 1 确认 */ }
  }

  // 3. 在 logs 中匹配任意接受代币的 Transfer → receiver
  const targetReceiver = pay.receiver;

  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;

    const contractAddr = log.address.toLowerCase();
    const tokenInfo = tokenMap[contractAddr];
    if (!tokenInfo) continue; // 不是我们接受的代币

    // 解析 to
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    if (to !== targetReceiver) continue;

    // 解析 from & amount
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const amountRaw = BigInt(log.data);
    const required = BigInt(pay.price) * BigInt(10 ** tokenInfo.decimals);

    if (amountRaw < required) {
      return {
        ok: false,
        error: 'INSUFFICIENT_AMOUNT',
        from,
        to,
        amount: amountRaw.toString(),
        token: contractAddr,
        symbol: tokenInfo.symbol,
      };
    }

    return {
      ok: true,
      from,
      to,
      amount: amountRaw.toString(),
      token: contractAddr,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      chain,
    };
  }

  return { ok: false, error: 'NO_MATCHING_TRANSFER' };
}

module.exports = { verifyPayment, getAcceptedTokens, getSupportedPayChains };
