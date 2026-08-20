# Crypto Wallet Monitor Bot (Telegram)

Bot de Telegram que vigila tus wallets **ERC20 (Ethereum), Polygon, BSC y TRC20 (Tron)** y te avisa por Telegram cada vez que recibís o enviás **USDT o USDC**, filtrando movimientos menores a un monto minimo (por defecto **10**) para evitar spam de tokens falsos.

## Como funciona

- Cada cierto intervalo (por defecto 60s), el bot consulta:
  - **Etherscan API v2** (multichain: sirve para Ethereum, Polygon y BSC con la misma API key) para ver transferencias del contrato de USDT y USDC hacia/desde tus wallets EVM.
  - **TronGrid API** para ver transferencias TRC20 (USDT/USDC) hacia/desde tu wallet de Tron.
- Guarda en `data/state.json` el ultimo bloque/timestamp revisado y los hashes ya notificados, para no repetir avisos.
- Si detecta un movimiento de **entrada o salida** mayor al monto minimo configurado, envia un mensaje al chat de Telegram indicado.

## Estructura del proyecto

```
crypto-monitor/
├── src/
│   ├── index.js           # Punto de entrada, loop principal
│   ├── config.js          # Carga variables de entorno y contratos de tokens
│   ├── telegram.js        # Envio de mensajes a Telegram
│   ├── state.js           # Persistencia simple en JSON
│   └── monitors/
│       ├── evm.js         # Monitor Ethereum / Polygon / BSC (Etherscan v2)
│       └── tron.js        # Monitor TRC20 (TronGrid)
├── data/                  # Se crea aqui el estado (state.json), NO se sube a git
├── .env.example           # Plantilla de variables de entorno
├── .env                   # Tus claves reales (NO se sube a git, ya esta en .gitignore)
├── package.json
└── README.md
```

## Requisitos

- Node.js 18 o superior
- Una API Key de [Etherscan](https://etherscan.io/apis) (la API v2 permite consultar Ethereum, Polygon y BSC con la misma key)
- Una API Key de [TronGrid](https://www.trongrid.io/)
- Un bot de Telegram creado con [@BotFather](https://t.me/BotFather) y tu `chat_id`

## Instalacion local

```bash
git clone https://github.com/ltbroker/Crypto_monitor.git
cd Crypto_monitor
npm install
cp .env.example .env
# Editar .env y completar tus claves y wallets reales
npm start
```

Al arrancar, el bot te va a mandar un mensaje de confirmacion a Telegram y empieza a monitorear.

## Variables de entorno (`.env`)

| Variable | Descripcion |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot obtenido de BotFather |
| `TELEGRAM_CHAT_ID` | Tu ID de chat/usuario de Telegram |
| `ETHERSCAN_API_KEY` | API key de Etherscan (API v2 multichain: cubre ERC20, Polygon y BSC con la misma key — BscScan migro sus keys a este sistema unico) |
| `TRONGRID_API_KEY` | API key de TronGrid |
| `WALLET_ERC20` / `WALLET_POLYGON` / `WALLET_BSC` | Tu(s) direccion(es) EVM. Se pueden poner varias separadas por coma, cada una con una etiqueta opcional despues de `:` (ej. `0xaaa...,0xbbb...:EXCHANGE LUIS`) |
| `WALLET_TRC20` | Tu(s) direccion(es) de Tron, mismo formato que arriba |
| `MIN_AMOUNT_USD` | Monto minimo para notificar (default `10`) |
| `POLL_INTERVAL_SECONDS` | Cada cuanto se revisan las wallets (default `60`) |
| `BACKFILL_HOURS` | Cuando el bot arranca sin estado guardado, hasta cuantas horas hacia atras notifica (default `48` = 2 dias). Nada mas viejo que esto se notifica |

## Subir el proyecto a GitHub

Ya tenes el repo creado: `https://github.com/ltbroker/Crypto_monitor`

**Opcion recomendada (linea de comandos, preserva carpetas correctamente):**

```bash
cd crypto-monitor
git init
git add .
git commit -m "Bot de monitoreo de wallets USDT/USDC"
git branch -M main
git remote add origin https://github.com/ltbroker/Crypto_monitor.git
git push -u origin main
```

> El archivo `.env` con tus claves reales **no se va a subir** porque esta en `.gitignore`. Solo se sube `.env.example` (con valores de ejemplo).

**Opcion alternativa (arrastrar y soltar en el navegador):**

Si preferis usar la pagina de carga (`.../Crypto_monitor/upload`), arrastra la carpeta `crypto-monitor` completa (o todos sus archivos y subcarpetas `src/` y `src/monitors/`) al area de carga. Verifica que **no** se incluya el archivo `.env` (solo `.env.example`), y que `node_modules/` no se suba (no es necesario, se reinstala con `npm install`).

## Dejarlo corriendo 24/7

Corriendo solo en tu compu, el bot se apaga si cerras la terminal o apagas la maquina. Opciones para que quede activo todo el tiempo:

1. **PM2 en un VPS propio** (DigitalOcean, un servidor casero, etc.):
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name crypto-monitor
   pm2 save
   pm2 startup
   ```

2. **Railway.app / Render.com** (planes gratuitos o de bajo costo):
   - Conecta el repo de GitHub `Crypto_monitor`.
   - Tipo de servicio: *Worker* / *Background Worker* (no necesita puerto HTTP).
   - Comando de arranque: `npm start`.
   - Cargá las mismas variables de entorno del `.env` en el panel de "Environment Variables" del servicio (no subas el `.env` real al repo, esto es lo que reemplaza esa carga manual).

3. **Docker** (opcional, si tu hosting lo prefiere): se puede agregar un `Dockerfile` simple con `node:18-alpine`, `npm install` y `CMD ["npm","start"]`.

## Seguridad — importante

- Las claves que me diste (Telegram, Etherscan, TronGrid) ya quedaron cargadas en tu `.env` local. Como las compartiste en esta conversacion, **te recomiendo regenerarlas** (revocar y crear nuevas) una vez que confirmes que el bot funciona, especialmente el token de Telegram y las API keys, para evitar que queden expuestas si este chat se comparte.
- Nunca subas el archivo `.env` real a un repositorio publico. El `.gitignore` ya lo excluye, pero conviene revisar `git status` antes de cada commit.
- Si el repo `Crypto_monitor` es publico, cualquiera que vea el codigo va a ver la logica pero no tus claves (siempre que no subas `.env`).

## Direcciones de contratos usadas

| Red | Token | Contrato |
|---|---|---|
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Polygon | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Polygon | USDC (nativo) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| BSC | USDT | `0x55d398326f99059fF775485246999027B3197955` |
| BSC | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| Tron | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| Tron | USDC | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` |

Si alguna de estas direcciones cambia o queres agregar otro token, se edita en `src/config.js`, seccion `tokens`.

## Varias wallets por red y etiquetas

Podes monitorear mas de una wallet por red. En cada variable `WALLET_*` separalas con coma, y opcionalmente agregale una etiqueta despues de `:` para identificarlas en las notificaciones:

```
WALLET_TRC20=TAe57xww2oXMi4ua2t417g3YCkzCNgWJh1,TGj7SRqyUXZwS1SwUAejUNWfdercw3cpVY:EXCHANGE LUIS
```

En este ejemplo, los avisos de la primera wallet no llevan etiqueta, y los de la segunda muestran "🏷️ EXCHANGE LUIS" en el mensaje de Telegram.

## Notas

- El bot revisa movimientos **entrantes y salientes** de todas las wallets configuradas.
- El filtro de $10 aplica sobre la cantidad de tokens (1 USDT/USDC ≈ 1 USD), no hace falta un oraculo de precio adicional ya que son stablecoins.
- **Ventana de backfill (2 dias por defecto):** cuando el bot arranca sin estado guardado (primera vez, o porque el hosting reinicio el contenedor y perdio `data/state.json`), no muestra todo el historial ni se queda en silencio total: notifica los movimientos que hayan pasado dentro de las ultimas `BACKFILL_HOURS` horas (48hs = 2 dias por defecto) y descarta en silencio todo lo mas viejo que eso. Ajustable con la variable `BACKFILL_HOURS`.
- Cada notificacion incluye la **fecha y hora del movimiento** (en horario de Argentina), ademas del monto, direccion y link a la transaccion.
- Si borras `data/state.json` (o si tu hosting no tiene almacenamiento persistente y se reinicia), el bot vuelve a aplicar la ventana de backfill la proxima vez que arranque.
- Probado en vivo en Railway: Telegram y Tron (TRC20) confirmados funcionando. Ethereum, Polygon y BSC usan la misma `ETHERSCAN_API_KEY` via la API v2 unificada de Etherscan.
