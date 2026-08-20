const axios = require('axios');
const config = require('../config');
const { sendMessage, formatTransferMessage } = require('../telegram');

const TRONGRID_URL = 'https://api.trongrid.io';
const BACKFILL_MS = config.backfillHours * 3600 * 1000;

/**
 * Obtiene las transferencias TRC20 (recientes) de una wallet en Tron.
 */
async function fetchTrc20Transfers({ walletAddress, contractAddress, minTimestamp }) {
  const url = `${TRONGRID_URL}/v1/accounts/${walletAddress}/transactions/trc20`;
  const params = {
    limit: 50,
    contract_address: contractAddress,
    order_by: 'block_timestamp,asc',
    only_confirmed: true,
  };
  if (minTimestamp) {
    params.min_timestamp = minTimestamp + 1;
  }

  const { data } = await axios.get(url, {
    params,
    timeout: 20000,
    headers: {
      'TRON-PRO-API-KEY': config.tronGridApiKey,
    },
  });

  return Array.isArray(data.data) ? data.data : [];
}

/**
 * Revisa UNA wallet TRC20 buscando transferencias nuevas de USDT/USDC por encima
 * del monto minimo configurado, y notifica por Telegram.
 */
async function checkWallet(wallet, state) {
  const networkConfig = config.tokens.trc20;
  const walletAddress = wallet.address;

  state.tron = state.tron || {};
  state.tron[walletAddress] = state.tron[walletAddress] || {};

  for (const [tokenSymbol, contractAddress] of Object.entries(networkConfig.contracts)) {
    const walletState = state.tron[walletAddress];
    // Si todavia no existe estado guardado, es la PRIMERA vez que se revisa este token
    // (o el hosting perdio el estado): en vez de traer todo el historial disponible,
    // arrancamos la busqueda desde la ventana de backfill configurada (por defecto 48hs).
    const isFirstRun = !walletState[tokenSymbol];

    const lastTimestamp = isFirstRun
      ? Date.now() - BACKFILL_MS
      : walletState[tokenSymbol]?.lastTimestamp || 0;
    const seenTxIds = new Set(walletState[tokenSymbol]?.seenTx || []);

    let transfers = [];
    try {
      transfers = await fetchTrc20Transfers({
        walletAddress,
        contractAddress,
        minTimestamp: lastTimestamp,
      });
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[TRON] Error consultando TRC20 / ${tokenSymbol} / ${walletAddress}:`, detail);
      continue;
    }

    let maxTimestamp = walletState[tokenSymbol]?.lastTimestamp || 0;
    let notified = 0;

    for (const tx of transfers) {
      const ts = tx.block_timestamp;
      if (ts > maxTimestamp) maxTimestamp = ts;

      if (seenTxIds.has(tx.transaction_id)) continue;
      seenTxIds.add(tx.transaction_id);

      const decimals = parseInt(tx.token_info?.decimals, 10) || 6;
      const amount = Number(tx.value) / 10 ** decimals;

      if (amount < config.minAmountUsd) continue;

      const from = tx.from;
      const to = tx.to;
      const direction = to === walletAddress ? 'IN' : from === walletAddress ? 'OUT' : null;

      if (!direction) continue;

      const message = formatTransferMessage({
        network: networkConfig.name,
        direction,
        token: tokenSymbol,
        amount: amount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        from,
        to,
        txHash: tx.transaction_id,
        explorerUrl: networkConfig.explorer,
        label: wallet.label,
        date: new Date(ts),
      });

      await sendMessage(message);
      notified++;
      console.log(
        `[TRON] Notificado: TRC20 ${tokenSymbol} ${direction} ${amount} (${walletAddress}${wallet.label ? ' - ' + wallet.label : ''})`
      );
    }

    if (isFirstRun) {
      console.log(
        `[TRON] Primera corrida TRC20/${tokenSymbol}/${walletAddress}: ${notified} notificados dentro de las ultimas ${config.backfillHours}hs.`
      );
    }

    const trimmedSeen = Array.from(seenTxIds).slice(-500);

    walletState[tokenSymbol] = {
      lastTimestamp: maxTimestamp,
      seenTx: trimmedSeen,
    };
  }
}

/**
 * Revisa todas las wallets TRC20 configuradas.
 */
async function checkTronNetwork(state) {
  const wallets = config.wallets.trc20 || [];
  for (const wallet of wallets) {
    await checkWallet(wallet, state);
  }
}

module.exports = { checkTronNetwork };
