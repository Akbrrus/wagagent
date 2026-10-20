import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../logger.js";
import { settingsStore } from "../store/settings.js";
import type { WagBot } from "../whatsapp/client.js";

let task: ScheduledTask | null = null;
let botRef: WagBot | null = null;

/** Ubah "HH:MM" menjadi cron expression "M H * * *". */
function timeToCron(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${m} ${h} * * *`;
}

/** Pasang/ubah jadwal ringkasan harian sesuai settings terbaru. */
export function reschedule(): void {
  if (!botRef) return;

  if (task) {
    task.stop();
    task = null;
  }

  const s = settingsStore.get();
  if (!s.scheduleEnabled) {
    logger.info("Penjadwalan ringkasan otomatis OFF.");
    return;
  }

  const expr = timeToCron(s.summaryTime);
  if (!cron.validate(expr)) {
    logger.error({ expr }, "Cron expression tidak valid, jadwal dilewati.");
    return;
  }

  task = cron.schedule(
    expr,
    () => {
      logger.info("⏰ Menjalankan ringkasan harian terjadwal.");
      botRef?.runSummaries().catch((err) =>
        logger.error({ err }, "Gagal menjalankan ringkasan terjadwal."),
      );
    },
    { timezone: s.timezone },
  );

  logger.info({ time: s.summaryTime, tz: s.timezone }, "Jadwal ringkasan harian aktif.");
}

/** Dipanggil sekali saat startup. */
export function initScheduler(bot: WagBot): void {
  botRef = bot;
  reschedule();
}
