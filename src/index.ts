import { config } from "./config.js";
import { logger } from "./logger.js";
import { messageStore } from "./store/messageStore.js";
import { settingsStore } from "./store/settings.js";
import { initScheduler } from "./summary/scheduler.js";
import { WagBot } from "./whatsapp/client.js";

async function main(): Promise<void> {
  logger.info("🚀 WagAgent starting...");
  logger.info({ model: config.claudeModel, dataDir: config.dataDir }, "Konfigurasi");

  // Muat state persisten.
  await settingsStore.load();
  await messageStore.load();

  // Sambungkan ke WhatsApp.
  const bot = new WagBot();
  await bot.connect();

  // Pasang penjadwal ringkasan harian.
  initScheduler(bot);

  // Buang pesan lama tiap jam supaya buffer tidak membengkak.
  setInterval(() => messageStore.prune(), 3600_000);

  logger.info("WagAgent siap. Menunggu scan QR / pesan masuk...");
}

const shutdown = (signal: string) => {
  logger.info({ signal }, "Menerima sinyal, mematikan...");
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.error({ err }, "Fatal error saat startup.");
  process.exit(1);
});
