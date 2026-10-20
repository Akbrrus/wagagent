import { config } from "../config.js";
import { logger } from "../logger.js";
import { messageStore } from "../store/messageStore.js";
import { settingsStore } from "../store/settings.js";
import { reschedule } from "../summary/scheduler.js";
import type { WagBot } from "./client.js";

export interface CommandContext {
  /** JID chat tempat perintah dikirim (grup atau pribadi). */
  chatJid: string;
  isGroup: boolean;
  /** Token perintah: args[0] = nama perintah, sisanya parameter. */
  args: string[];
  raw: string;
}

const P = config.commandPrefix;

const HELP_TEXT = `🤖 *WagAgent — Daftar Perintah*

${P}help — tampilkan bantuan ini
${P}summary — ringkas grup ini (24 jam terakhir)
${P}summary all — ringkas SEMUA grup sekarang, kirim ke target
${P}status — tampilkan pengaturan saat ini
${P}settime HH:MM — set jam ringkasan harian (contoh: ${P}settime 21:00)
${P}settz <Zona> — set timezone (contoh: ${P}settz Asia/Jakarta)
${P}setlang id|en — bahasa ringkasan
${P}on / ${P}off — aktifkan / matikan ringkasan otomatis
${P}settarget — jadikan chat INI sebagai tujuan ringkasan
${P}exclude — kecualikan grup ini dari ringkasan otomatis
${P}include — ikutkan lagi grup ini
${P}groups — daftar grup yang sedang dipantau`;

function isValidTime(t: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);
}

export async function handleCommand(
  bot: WagBot,
  ctx: CommandContext,
): Promise<void> {
  const cmd = (ctx.args[0] ?? "").toLowerCase();
  const reply = (text: string) => bot.sendText(ctx.chatJid, text);

  logger.info({ cmd, chatJid: ctx.chatJid }, "Memproses perintah.");

  try {
    switch (cmd) {
      case "help":
      case "":
        await reply(HELP_TEXT);
        break;

      case "summary":
      case "ringkas": {
        if ((ctx.args[1] ?? "").toLowerCase() === "all") {
          await reply("⏳ Membuat ringkasan semua grup...");
          await bot.runSummaries();
        } else if (ctx.isGroup) {
          await reply("⏳ Membuat ringkasan grup ini...");
          await bot.summarizeSingle(ctx.chatJid, ctx.chatJid);
        } else {
          await reply(`Perintah ${P}summary (tanpa "all") hanya bisa dipakai di dalam grup. Gunakan ${P}summary all dari chat pribadi.`);
        }
        break;
      }

      case "status": {
        const s = settingsStore.get();
        const target = s.summaryTarget || `${bot.getOwnJid()} (chat sendiri)`;
        await reply(
          `⚙️ *Status WagAgent*\n` +
            `Jam ringkasan: *${s.summaryTime}* (${s.timezone})\n` +
            `Otomatis: *${s.scheduleEnabled ? "ON" : "OFF"}*\n` +
            `Bahasa: *${s.language}*\n` +
            `Model: *${config.claudeModel}*\n` +
            `Target: ${target}\n` +
            `Grup dipantau: *${messageStore.listGroups().length}*\n` +
            `Grup dikecualikan: *${s.excludedGroups.length}*`,
        );
        break;
      }

      case "settime": {
        const t = ctx.args[1] ?? "";
        if (!isValidTime(t)) {
          await reply(`Format jam salah. Contoh: ${P}settime 21:00`);
          break;
        }
        await settingsStore.update({ summaryTime: t });
        reschedule();
        await reply(`✅ Jam ringkasan harian diset ke *${t}*.`);
        break;
      }

      case "settz": {
        const tz = ctx.args[1] ?? "";
        if (!tz) {
          await reply(`Contoh: ${P}settz Asia/Jakarta`);
          break;
        }
        try {
          // Validasi timezone via Intl.
          new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
        } catch {
          await reply(`Timezone "${tz}" tidak valid.`);
          break;
        }
        await settingsStore.update({ timezone: tz });
        reschedule();
        await reply(`✅ Timezone diset ke *${tz}*.`);
        break;
      }

      case "setlang": {
        const lang = (ctx.args[1] ?? "").toLowerCase();
        if (lang !== "id" && lang !== "en") {
          await reply(`Pilih bahasa: ${P}setlang id  atau  ${P}setlang en`);
          break;
        }
        await settingsStore.update({ language: lang });
        await reply(`✅ Bahasa ringkasan: *${lang}*.`);
        break;
      }

      case "on": {
        await settingsStore.update({ scheduleEnabled: true });
        reschedule();
        await reply("✅ Ringkasan otomatis *diaktifkan*.");
        break;
      }

      case "off": {
        await settingsStore.update({ scheduleEnabled: false });
        reschedule();
        await reply("⏸️ Ringkasan otomatis *dimatikan*.");
        break;
      }

      case "settarget": {
        await settingsStore.update({ summaryTarget: ctx.chatJid });
        await reply("✅ Chat ini dijadikan tujuan pengiriman ringkasan.");
        break;
      }

      case "exclude": {
        if (!ctx.isGroup) {
          await reply("Perintah ini hanya di dalam grup.");
          break;
        }
        const s = settingsStore.get();
        if (!s.excludedGroups.includes(ctx.chatJid)) {
          await settingsStore.update({
            excludedGroups: [...s.excludedGroups, ctx.chatJid],
          });
        }
        await reply("🚫 Grup ini dikecualikan dari ringkasan otomatis.");
        break;
      }

      case "include": {
        if (!ctx.isGroup) {
          await reply("Perintah ini hanya di dalam grup.");
          break;
        }
        const s = settingsStore.get();
        await settingsStore.update({
          excludedGroups: s.excludedGroups.filter((j) => j !== ctx.chatJid),
        });
        await reply("✅ Grup ini diikutkan lagi dalam ringkasan otomatis.");
        break;
      }

      case "groups": {
        const groups = messageStore.listGroups();
        if (groups.length === 0) {
          await reply("Belum ada grup dengan aktivitas tersimpan.");
          break;
        }
        const list = groups
          .map((j, i) => `${i + 1}. ${messageStore.getGroupName(j)}`)
          .join("\n");
        await reply(`📑 *Grup dipantau (${groups.length})*\n${list}`);
        break;
      }

      default:
        await reply(`Perintah tidak dikenal: ${cmd}\nKetik ${P}help untuk daftar perintah.`);
    }
  } catch (err) {
    logger.error({ err, cmd }, "Gagal memproses perintah.");
    await reply("⚠️ Terjadi error saat memproses perintah.").catch(() => {});
  }
}
