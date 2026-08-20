const axios = require('axios');
const config = require('../config');
const { sendMessage, formatTransferMessage } = require('../telegram');

// Etherscan API V2 unificada: un solo endpoint + apikey sirve para Ethereum y Polygon.
const ETHERSCAN_V2_URL = 'https://api.etherscan.io/v2/api';

// Topic0 del evento estandar ERC20: Transfer(address indexed from, address indexed to, uint256 value)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const BACKFILL_SECONDS = config.backfillHours * 3600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Si el primer nodo de la lista es una URL autenticada (tiene una API key propia,
// ej. Ankr con ANKR_API_KEY), lo dejamos siempre primero porque tiene cuota
// dedicada y es mucho mas confiable. El resto son nodos publicos compartidos de
// respaldo: entre esos si rotamos cual se prueba primero en cada llamada, para
// repartir la carga y no golpear siempre al mismo (lo que dispara bloqueos).
let rpcRotationIndex = 0;
function rotatedUrls(urls) {
  const isFirstAuthenticated = /\/[a-f0-9]{32,}$/i.test(urls[0] || '');
  const pinned = isFirstAuthenticated ? [urls[0]] : [];
  const rest = isFirstAuthenticated ? urls.slice(1) : urls;

  if (rest.length === 0) return pinned;

  const start = rpcRotationIndex % rest.length;
  rpcRotationIndex++;
  const rotatedRest = [...rest.slice(start), ...rest.slice(0, start)];
  return [...pinned, ...rotatedRest];
}

/**
 * Llama a un nodo RPC JSON-RPC publico, probando varios endpoints por si alguno falla,
 * con reintentos y backoff si todos fallan (util contra bloqueos temporales 403/429).
 */
async function rpcCall(urls, method, params, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const orderedUrls = rotatedUrls(urls);
    for (const url of orderedUrls) {
      try {
        const { data } = await axios.post(
          url,
          { jsonrpc: '2.0', id: 1, method, params },
          { timeout: 15000 }
        );
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        return data.result;
      } catch (err) {
        lastError = err;
      }
    }
    if (attempt < retries) {
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastError;
}

function topicToAddress(topic) {
  return '0x' + topic.slice(26).toLowerCase();
}

function addressToTopic(address) {
  return '0x' + '0'.repeat(24) + address.slice(2).toLowerCase();
}

/**
 * Pide un bloque por numero. Si un nodo devuelve un resultado vacio (null) en vez
 * de un error (le puede pasar a un nodo que todavia no sincronizo ese bloque),
 * lo tratamos igual como fallo y probamos con otro nodo antes de rendirnos.
 */
async function getBlock(rpcUrls, blockNumber, { retries = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const block = await rpcCall(rpcUrls, 'eth_getBlockByNumber', ['0x' + blockNumber.toString(16), false], {
        retries: 0,
      });
      if (block && block.timestamp) return block;
      lastError = new Error(`Bloque ${blockNumber} vacio/no encontrado`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(500 * (attempt + 1));
  }
  throw lastError;
}

/**
 * Consulta transferencias de un token via Etherscan API v2 (Ethereum / Polygon).
 */
async function fetchTokenTransfersEtherscan({ networkKey, chainId, contractAddress, walletAddress, startBlock }) {
  const params = {
    module: 'account',
    action: 'tokentx',
    contractaddress: contractAddress,
    address: walletAddress,
    startblock: startBlock || 0,
    endblock: 99999999,
    sort: 'asc',
    chainid: chainId,
    apikey: config.etherscanApiKey,
  };

  const { data } = await axios.get(ETHERSCAN_V2_URL, { params, timeout: 20000 });

  if (data.status === '0' && data.message !== 'No transactions found') {
    console.warn(`[EVM] Aviso (${networkKey}):`, data.result || data.message);
    return { transfers: [], latestBlock: startBlock || 0 };
  }

  const rawTransfers = Array.isArray(data.result) ? data.result : [];
  const transfers = rawTransfers.map((tx) => ({
    blockNumber: tx.blockNumber,
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    tokenDecimal: tx.tokenDecimal,
    timestamp: parseInt(tx.timeStamp, 10), // segundos unix, provisto por Etherscan
  }));

  const latestBlock = transfers.reduce(
    (max, tx) => Math.max(max, parseInt(tx.blockNumber, 10)),
    startBlock || 0
  );

  return { transfers, latestBlock };
}

/**
 * Calibra el tiempo promedio de bloque midiendo dos bloques separados, y con eso
 * calcula cuantos bloques hacia atras corresponden a la ventana de backfill.
 */
async function estimateBackfillFromBlock(rpcUrls, latestBlock) {
  const sampleDistance = 10000;
  const olderBlockNumber = Math.max(0, latestBlock - sampleDistance);

  const [latestBlockData, olderBlockData] = await Promise.all([
    getBlock(rpcUrls, latestBlock),
    getBlock(rpcUrls, olderBlockNumber),
  ]);

  const latestTs = parseInt(latestBlockData.timestamp, 16);
  const olderTs = parseInt(olderBlockData.timestamp, 16);
  const blocksSampled = latestBlock - olderBlockNumber;
  const avgBlockTime = blocksSampled > 0 ? (latestTs - olderTs) / blocksSampled : 3;

  // +20% de margen de seguridad para no quedarnos cortos si el tiempo de bloque varia.
  const blocksForWindow = Math.ceil((BACKFILL_SECONDS / Math.max(avgBlockTime, 0.5)) * 1.2);

  return Math.max(0, latestBlock - blocksForWindow);
}

/**
 * Consulta transferencias de un token en BSC via RPC publico (eth_getLogs), sin
 * depender de ninguna API key. En la primera corrida escanea solo la ventana de
 * backfill configurada (por defecto 48hs), no el historial completo.
 */
async function fetchTokenTransfersRpc({ rpcUrls, contractAddress, walletAddress, startBlock, isFirstRun }) {
  const latestBlockHex = await rpcCall(rpcUrls, 'eth_blockNumber', []);
  const latestBlock = parseInt(latestBlockHex, 16);

  let fromBlock;
  if (isFirstRun) {
    fromBlock = await estimateBackfillFromBlock(rpcUrls, latestBlock);
  } else {
    fromBlock = startBlock + 1;
  }

  if (fromBlock > latestBlock) {
    return { transfers: [], latestBlock: isFirstRun ? latestBlock : startBlock };
  }

  const walletTopic = addressToTopic(walletAddress);

  // El rango se pide en tandas para no exceder los limites de los RPC publicos.
  const CHUNK_SIZE = 2000;
  // Pausa entre tandas para no golpear los nodos publicos en rafaga.
  const DELAY_BETWEEN_CHUNKS_MS = 500;
  // Minimo al que estamos dispuestos a partir un rango si un nodo lo rechaza
  // por "limit exceeded" (limite de rango de bloques del propio nodo).
  const MIN_RANGE_SIZE = 250;

  /**
   * Pide eth_getLogs para un rango de bloques. Si el nodo lo rechaza por ser
   * demasiado ancho (ej. "limit exceeded"), partimos el rango en dos mitades y
   * reintentamos cada una por separado, en vez de descartar toda la tanda.
   */
  async function fetchLogsAdaptive(topics, rangeStart, rangeEnd) {
    const fromHex = '0x' + rangeStart.toString(16);
    const toHex = '0x' + rangeEnd.toString(16);
    try {
      return await rpcCall(rpcUrls, 'eth_getLogs', [
        { address: contractAddress, topics, fromBlock: fromHex, toBlock: toHex },
      ]);
    } catch (err) {
      const rangeSize = rangeEnd - rangeStart + 1;
      if (rangeSize <= MIN_RANGE_SIZE) throw err;

      const mid = rangeStart + Math.floor(rangeSize / 2) - 1;
      await sleep(DELAY_BETWEEN_CHUNKS_MS);
      const firstHalf = await fetchLogsAdaptive(topics, rangeStart, mid);
      await sleep(DELAY_BETWEEN_CHUNKS_MS);
      const secondHalf = await fetchLogsAdaptive(topics, mid + 1, rangeEnd);
      return [...firstHalf, ...secondHalf];
    }
  }

  const allLogs = [];
  // Para cada log guardamos los limites (chunkStart/chunkEnd) del chunk del que
  // salio, y despues interpolamos el timestamp entre esos dos limites en vez de
  // pedir el bloque exacto de cada log (eso multiplicaba muchisimo la cantidad
  // de llamadas RPC).
  let isFirstChunk = true;
  for (let chunkStart = fromBlock; chunkStart <= latestBlock; chunkStart += CHUNK_SIZE) {
    if (!isFirstChunk) await sleep(DELAY_BETWEEN_CHUNKS_MS);
    isFirstChunk = false;

    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, latestBlock);

    // Dos consultas secuenciales (no en paralelo, para no duplicar la rafaga de
    // requests): una por "de esta wallet" (topic[1]) y otra por "hacia esta
    // wallet" (topic[2]).
    const outgoingLogs = await fetchLogsAdaptive([TRANSFER_TOPIC, walletTopic, null], chunkStart, chunkEnd);
    await sleep(DELAY_BETWEEN_CHUNKS_MS);
    const incomingLogs = await fetchLogsAdaptive([TRANSFER_TOPIC, null, walletTopic], chunkStart, chunkEnd);

    const chunkLogs = [...outgoingLogs, ...incomingLogs];
    allLogs.push(...chunkLogs.map((log) => ({ log, chunkStart, chunkEnd })));
  }

  // Solo pedimos el timestamp real de los limites de los chunks que SI tuvieron
  // logs (en vez de uno por log), y despues interpolamos linealmente. Si un nodo
  // falla en darnos ese bloque, no abortamos toda la corrida: usamos "ahora" como
  // ultimo recurso, para no perder la notificacion por un dato de fecha aproximado.
  const boundsTimestampCache = new Map();
  async function getBoundTimestamp(blockNumber) {
    if (boundsTimestampCache.has(blockNumber)) return boundsTimestampCache.get(blockNumber);
    let ts;
    try {
      const block = await getBlock(rpcUrls, blockNumber);
      ts = parseInt(block.timestamp, 16);
    } catch (err) {
      console.warn(`[EVM] No se pudo obtener el timestamp del bloque ${blockNumber}, uso la hora actual como aproximacion:`, err.message);
      ts = Math.floor(Date.now() / 1000);
    }
    boundsTimestampCache.set(blockNumber, ts);
    return ts;
  }

  const transfers = [];
  for (const { log, chunkStart, chunkEnd } of allLogs) {
    const blockNumber = parseInt(log.blockNumber, 16);

    const startTs = await getBoundTimestamp(chunkStart);
    const endTs = await getBoundTimestamp(chunkEnd);
    const span = chunkEnd - chunkStart;
    const ratio = span > 0 ? (blockNumber - chunkStart) / span : 0;
    const timestamp = Math.round(startTs + (endTs - startTs) * ratio);

    transfers.push({
      blockNumber: String(blockNumber),
      hash: log.transactionHash,
      from: topicToAddress(log.topics[1]),
      to: topicToAddress(log.topics[2]),
      value: BigInt(log.data).toString(),
      timestamp,
    });
  }

  return { transfers, latestBlock };
}

/**
 * Revisa UNA wallet en una red EVM (erc20 | polygon | bsc) buscando transferencias
 * nuevas de USDT/USDC por encima del monto minimo configurado, y notifica por Telegram.
 */
async function checkWallet(networkKey, wallet, state) {
  const networkConfig = config.tokens[networkKey];
  const walletAddress = wallet.address;
  const isBsc = networkKey === 'bsc';
  const nowSeconds = Math.floor(Date.now() / 1000);

  state.evm = state.evm || {};
  state.evm[networkKey] = state.evm[networkKey] || {};
  state.evm[networkKey][walletAddress] = state.evm[networkKey][walletAddress] || {};

  let isFirstTokenInLoop = true;
  for (const [tokenSymbol, tokenInfo] of Object.entries(networkConfig.contracts)) {
    // En BSC espaciamos tambien las consultas entre tokens (USDT/USDC) para no
    // encadenar rafagas de requests contra los mismos nodos RPC publicos.
    if (isBsc && !isFirstTokenInLoop) await sleep(500);
    isFirstTokenInLoop = false;

    const contractAddress = tokenInfo.address;
    const decimals = tokenInfo.decimals;
    const walletState = state.evm[networkKey][walletAddress];
    // Si todavia no existe estado guardado para este token/wallet, es la PRIMERA vez que
    // se revisa (o el hosting perdio el estado): aplicamos la ventana de backfill.
    const isFirstRun = !walletState[tokenSymbol];

    const lastBlock = walletState[tokenSymbol]?.lastBlock || 0;
    const seenTxHashes = new Set(walletState[tokenSymbol]?.seenTx || []);

    let transfers = [];
    let latestBlock = lastBlock;

    try {
      if (isBsc) {
        const result = await fetchTokenTransfersRpc({
          rpcUrls: networkConfig.rpcUrls,
          contractAddress,
          walletAddress,
          startBlock: lastBlock,
          isFirstRun,
        });
        transfers = result.transfers;
        latestBlock = result.latestBlock;
      } else {
        const result = await fetchTokenTransfersEtherscan({
          networkKey,
          chainId: networkConfig.chainId,
          contractAddress,
          walletAddress,
          startBlock: lastBlock,
        });
        transfers = result.transfers;
        latestBlock = result.latestBlock;
      }
    } catch (err) {
      console.error(`[EVM] Error consultando ${networkConfig.name} / ${tokenSymbol} / ${walletAddress}:`, err.message);
      continue;
    }

    let notified = 0;
    let skippedOld = 0;

    for (const tx of transfers) {
      if (seenTxHashes.has(tx.hash)) continue;
      seenTxHashes.add(tx.hash);

      // En la primera corrida, solo notificamos lo que esta dentro de la ventana de backfill.
      if (isFirstRun && nowSeconds - tx.timestamp > BACKFILL_SECONDS) {
        skippedOld++;
        continue;
      }

      const tokenDecimals = tx.tokenDecimal !== undefined ? parseInt(tx.tokenDecimal, 10) : decimals;
      const amount = Number(tx.value) / 10 ** tokenDecimals;

      if (amount < config.minAmountUsd) continue;

      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      const direction = to === walletAddress ? 'IN' : from === walletAddress ? 'OUT' : null;

      if (!direction) continue;
      if (wallet.onlyIn && direction !== 'IN') continue;
      if (wallet.onlyOut && direction !== 'OUT') continue;

      const message = formatTransferMessage({
        network: networkConfig.name,
        direction,
        token: tokenSymbol,
        amount: amount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        from: tx.from,
        to: tx.to,
        txHash: tx.hash,
        explorerUrl: networkConfig.explorer,
        label: wallet.label,
        date: new Date(tx.timestamp * 1000),
      });

      await sendMessage(message);
      notified++;
      console.log(
        `[EVM] Notificado: ${networkConfig.name} ${tokenSymbol} ${direction} ${amount} (${walletAddress}${wallet.label ? ' - ' + wallet.label : ''})`
      );
    }

    if (isFirstRun) {
      console.log(
        `[EVM] Primera corrida en ${networkConfig.name}/${tokenSymbol}/${walletAddress}: ${notified} notificados dentro de las ultimas ${config.backfillHours}hs, ${skippedOld} mas viejas ignoradas (bloque ${latestBlock}).`
      );
    }

    // Solo conservamos los ultimos 500 hashes vistos para no crecer indefinidamente
    const trimmedSeen = Array.from(seenTxHashes).slice(-500);

    walletState[tokenSymbol] = {
      lastBlock: latestBlock,
      seenTx: trimmedSeen,
    };
  }
}

/**
 * Revisa todas las wallets configuradas de una red EVM (erc20 | polygon | bsc).
 */
async function checkNetwork(networkKey, state) {
  const wallets = config.wallets[networkKey] || [];
  const isBsc = networkKey === 'bsc';
  let isFirstWallet = true;
  for (const wallet of wallets) {
    // Espaciamos tambien entre wallets en BSC, por la misma razon (nodos RPC publicos).
    if (isBsc && !isFirstWallet) await sleep(500);
    isFirstWallet = false;
    await checkWallet(networkKey, wallet, state);
  }
}

/**
 * Revisa las tres redes EVM configuradas: erc20, polygon y bsc.
 */
async function checkAllEvmNetworks(state) {
  await checkNetwork('erc20', state);
  await checkNetwork('polygon', state);
  await checkNetwork('bsc', state);
}

module.exports = { checkAllEvmNetworks };
