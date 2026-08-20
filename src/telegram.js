const axios = require('axios');
const config = require('./config');

const API_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Envia un mensaje de texto al chat configurado.
 * @param {string} text - Texto en formato Markdown (HTML tambien soportado).
 */
async function sendMessage(text) {
  try {
    await axios.post(`${API_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[TELEGRAM] Error enviando mensaje:', detail);
  }
}

function formatWalletList(wallets) {
  if (!wallets.length) return '  (ninguna configurada)';
  return wallets
    .map((w) => `  - <code>${w.address}</code>${w.label ? ` [${w.label}]` : ''}`)
    .join('\n');
}

/**
 * Notifica al arrancar el bot para confirmar que esta activo.
 */
async function sendStartupMessage() {
  const lines = [
    '🤖 <b>Crypto Wallet Monitor iniciado</b>',
    '',
    `Monitoreando USDT/USDC (montos > $${config.minAmountUsd})`,
    `Intervalo de sondeo: ${config.pollIntervalSeconds}s`,
    '',
    '• ERC20:',
    formatWalletList(config.wallets.erc20),
    '• Polygon:',
    formatWalletList(config.wallets.polygon),
    '• BSC:',
    formatWalletList(config.wallets.bsc),
    '• TRC20:',
    formatWalletList(config.wallets.trc20),
  ];
  await sendMessage(lines.join('\n'));
}

/**
 * Formatea una fecha en horario de Argentina, ej: "19/08/2026 20:15".
 * @param {Date} date
 */
function formatDateArgentina(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatTransferMessage({ network, direction, token, amount, from, to, txHash, explorerUrl, label, date }) {
  const icon = direction === 'IN' ? '🟢 DEPOSITO' : '🔴 RETIRO';
  const lines = [
    `${icon} <b>${amount} ${token}</b> (${network})`,
  ];

  if (label) {
    lines.push(`🏷️ <b>${label}</b>`);
  }

  const formattedDate = formatDateArgentina(date);
  if (formattedDate) {
    lines.push(`🕒 ${formattedDate} (Argentina)`);
  }

  lines.push(
    '',
    `De: <code>${from}</code>`,
    `Para: <code>${to}</code>`,
    '',
    `<a href="${explorerUrl}${txHash}">Ver transaccion</a>`
  );

  return lines.join('\n');
}

module.exports = {
  sendMessage,
  sendStartupMessage,
  formatTransferMessage,
};
