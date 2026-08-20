const config = require('./config');
const { loadState, saveState } = require('./state');
const { checkAllEvmNetworks } = require('./monitors/evm');
const { checkTronNetwork } = require('./monitors/tron');
const { sendStartupMessage, sendMessage } = require('./telegram');

let running = false;

async function runCheckCycle(state) {
  if (running) {
    console.log('[LOOP] Ciclo anterior aun en curso, se omite este tick.');
    return;
  }
  running = true;
  try {
    await checkAllEvmNetworks(state);
    await checkTronNetwork(state);
    saveState(state);
  } catch (err) {
    console.error('[LOOP] Error inesperado en el ciclo de chequeo:', err);
  } finally {
    running = false;
  }
}

async function main() {
  console.log('=== Crypto Wallet Monitor Bot ===');
  console.log(`Monto minimo: $${config.minAmountUsd}`);
  console.log(`Intervalo: ${config.pollIntervalSeconds}s`);

  const state = loadState();

  await sendStartupMessage().catch((err) =>
    console.error('[STARTUP] No se pudo enviar el mensaje de arranque:', err.message)
  );

  // Primer chequeo inmediato
  await runCheckCycle(state);

  // Chequeos periodicos
  setInterval(() => {
    runCheckCycle(state);
  }, config.pollIntervalSeconds * 1000);
}

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Bot detenido por el usuario.');
  process.exit(0);
});

main().catch((err) => {
  console.error('[FATAL] Error al iniciar el bot:', err);
  process.exit(1);
});
