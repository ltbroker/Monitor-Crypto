require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[CONFIG] Falta la variable de entorno: ${name}. Revisa tu archivo .env`);
  }
  return value;
}

/**
 * Parsea una lista de wallets desde una variable de entorno.
 * Formato: "direccion[:Etiqueta][|flags]", separadas por coma.
 *   - La etiqueta es opcional (va despues de ":").
 *   - Los flags son opcionales (van despues de "|", separados por coma si hay mas de uno):
 *       onlyin  -> solo notifica depositos (IN), ignora retiros (OUT)
 *       onlyout -> solo notifica retiros (OUT), ignora depositos (IN)
 * Ejemplos:
 *   0xaaa...
 *   0xaaa...:EXCHANGE LUIS
 *   0xaaa...:EXCHANGE LUIS|onlyin
 *   0xaaa...|onlyin  (sin etiqueta)
 */
function parseWalletList(envValue, { lowercase = false } = {}) {
  if (!envValue) return [];

  return envValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [addressLabelPart, flagsPart] = entry.split('|');
      const trimmedPart = addressLabelPart.trim();

      const separatorIndex = trimmedPart.indexOf(':');
      let address = trimmedPart;
      let label = null;

      if (separatorIndex !== -1) {
        address = trimmedPart.slice(0, separatorIndex).trim();
        label = trimmedPart.slice(separatorIndex + 1).trim() || null;
      }

      const flags = (flagsPart || '')
        .split(',')
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);

      return {
        address: lowercase ? address.toLowerCase() : address,
        label,
        onlyIn: flags.includes('onlyin'),
        onlyOut: flags.includes('onlyout'),
      };
    });
}

const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },
  // Una sola API key de Etherscan (API v2) sirve para Ethereum, Polygon y BSC.
  // BscScan migro sus keys a este sistema unico, ya no hace falta una key separada.
  etherscanApiKey: required('ETHERSCAN_API_KEY'),
  tronGridApiKey: required('TRONGRID_API_KEY'),
  minAmountUsd: parseFloat(process.env.MIN_AMOUNT_USD || '10'),
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10),
  // Cuando el bot arranca sin estado guardado (primera vez, o porque el hosting
  // reinicio el contenedor y perdio el archivo de estado), en vez de mostrar TODO
  // el historial o quedarse en silencio total, notifica solo lo que paso dentro
  // de esta ventana de horas hacia atras (por defecto 48hs = 2 dias).
  backfillHours: parseFloat(process.env.BACKFILL_HOURS || '48'),

  // Cada red admite UNA O VARIAS wallets, separadas por coma. Cada wallet puede
  // llevar una etiqueta opcional despues de ":", que aparece en las notificaciones.
  // Ejemplo: WALLET_ERC20=0xaaa...,0xbbb...:EXCHANGE LUIS
  wallets: {
    erc20: parseWalletList(process.env.WALLET_ERC20, { lowercase: true }),
    polygon: parseWalletList(process.env.WALLET_POLYGON, { lowercase: true }),
    bsc: parseWalletList(process.env.WALLET_BSC, { lowercase: true }),
    trc20: parseWalletList(process.env.WALLET_TRC20), // direcciones Tron son sensibles a mayusculas/minusculas
  },

  // Direcciones de contratos de USDT / USDC por red.
  // Fuente: contratos oficiales publicados por Tether y Circle.
  tokens: {
    erc20: {
      chainId: 1,
      name: 'Ethereum (ERC20)',
      explorer: 'https://etherscan.io/tx/',
      contracts: {
        USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      },
    },
    polygon: {
      chainId: 137,
      name: 'Polygon',
      explorer: 'https://polygonscan.com/tx/',
      contracts: {
        USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
        // USDC nativo emitido por Circle en Polygon
        USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      },
    },
    bsc: {
      chainId: 56,
      name: 'BNB Smart Chain (BEP20)',
      explorer: 'https://bscscan.com/tx/',
      // Se consulta via RPC publico (eth_getLogs), no via Etherscan API - por eso
      // no depende de ninguna API key ni de un plan pago.
      rpcUrls: [
        'https://bsc-dataseed.binance.org/',
        'https://bsc-dataseed1.defibit.io/',
        'https://bsc-dataseed1.ninicoin.io/',
        'https://bsc.publicnode.com',
      ],
      contracts: {
        // Los tokens "Binance-Peg" en BSC usan 18 decimales (no 6, a diferencia de Ethereum).
        USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
        USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      },
    },
    trc20: {
      name: 'Tron (TRC20)',
      explorer: 'https://tronscan.org/#/transaction/',
      contracts: {
        USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
      },
    },
  },
};

module.exports = config;
