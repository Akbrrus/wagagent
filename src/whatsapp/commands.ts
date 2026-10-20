import { config } from "../config.js";
import { logger } from "../logger.js";
import { messageStore } from "../store/messageStore.js";
import { settingsStore } from "../store/settings.js";
import { reschedule } from "../summary/scheduler.js";
import { providerLabel } from "../summary/llmClient.js";
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

*Mode pilih grup:*
${P}allgroups — tampilkan semua grup + ID-nya (untuk di-copy)
${P}whitelist <id> [id...] — HANYA ringkas grup dengan ID ini (aktifkan mode whitelist)
${P}unwhitelist <id> [id...] — keluarkan grup dari whitelist
${P}watchall — kembali ringkas SEMUA grup (mode default)
${P}exclude — (mode all) kecualikan grup ini
${P}include — (mode all) ikutkan lagi grup ini
${P}groups — daftar grup yang punya aktivitas tersimpan

_Tip: ${P}whitelist tanpa ID, dikirim di dalam grup, akan memakai grup itu._`;

function isValidTime(t: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);
}

/**
 * Normalisasi argumen menjadi JID grup yang valid.
 * Menerima JID lengkap ("...@g.us") atau ID polos (otomatis ditambah "@g.us").
 * Token yang jelas bukan grup diabaikan.
 */
function parseGroupJids(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim().replace(/[`,]/g, ""); // buang backtick/koma bila ter-copy
    if (!t) continue;
    if (t.endsWith("@g.us")) {
      out.push(t);
    } else if (/^[\d-]+$/.test(t)) {
      out.push(`${t}@g.us`);
    }
    // selain itu (mis. "@s.whatsapp.net") diabaikan.
  }
  return Array.from(new Set(out));
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
          // Perintah manual: kirim hasil ke chat tempat perintah ini dikirim.
          const r = await bot.runSummaries(24, ctx.chatJid);
          if (!r.noGroups) {
            await reply(
              `✅ Ringkasan selesai: *${r.summarized}* grup diringkas, *${r.empty}* tanpa pesan baru.`,
            );
          }
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
            `LLM: *${providerLabel()}*\n` +
            `Target: ${target}\n` +
            `Mode grup: *${s.watchMode}*\n` +
            (s.watchMode === "whitelist"
              ? `Whitelist: *${s.whitelistGroups.length}* grup\n`
              : `Grup dipantau: *${messageStore.listGroups().length}* | dikecualikan: *${s.excludedGroups.length}*\n`),
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

      case "allgroups": {
        await reply("⏳ Mengambil daftar semua grup...");
        const all = await bot.listAllGroups();
        if (all.length === 0) {
          await reply("Tidak ada grup ditemukan.");
          break;
        }
        const s = settingsStore.get();
        // WhatsApp membatasi panjang pesan; pecah per 40 grup.
        const lines = all.map((g, i) => {
          const mark = s.whitelistGroups.includes(g.jid) ? "✅" : "▫️";
          return `${i + 1}. ${mark} ${g.subject}\n    \`${g.jid}\``;
        });
        for (let i = 0; i < lines.length; i += 40) {
          const chunk = lines.slice(i, i + 40).join("\n");
          await reply(
            i === 0
              ? `📑 *Semua grup (${all.length})* — ✅ = sudah di-whitelist\n\n${chunk}\n\n_Salin ID lalu: ${P}whitelist <id1> <id2> ..._`
              : chunk,
          );
        }
        break;
      }

      case "whitelist": {
        const ids = parseGroupJids(ctx.args.slice(1));
        // Tanpa argumen & di dalam grup → pakai grup ini (cara lama, tetap didukung).
        if (ids.length === 0 && ctx.isGroup) ids.push(ctx.chatJid);
        if (ids.length === 0) {
          await reply(
            `Cara pakai:\n${P}whitelist <id-grup> [<id-grup> ...]\nContoh: ${P}whitelist 1203...@g.us 1204...@g.us\n\nLihat ID grup dengan ${P}allgroups`,
          );
          break;
        }
        const s = settingsStore.get();
        const merged = Array.from(new Set([...s.whitelistGroups, ...ids]));
        await settingsStore.update({
          watchMode: "whitelist",
          whitelistGroups: merged,
        });
        const names = ids
          .map((j) => `• ${messageStore.getGroupName(j)}`)
          .join("\n");
        await reply(
          `✅ Ditambahkan ke whitelist:\n${names}\n\nMode: *whitelist* (total ${merged.length} grup diringkas).`,
        );
        break;
      }

      case "unwhitelist": {
        const ids = parseGroupJids(ctx.args.slice(1));
        if (ids.length === 0 && ctx.isGroup) ids.push(ctx.chatJid);
        if (ids.length === 0) {
          await reply(`Cara pakai: ${P}unwhitelist <id-grup> [<id-grup> ...]`);
          break;
        }
        const s = settingsStore.get();
        await settingsStore.update({
          whitelistGroups: s.whitelistGroups.filter((j) => !ids.includes(j)),
        });
        await reply(`🚫 ${ids.length} grup dikeluarkan dari whitelist.`);
        break;
      }

      case "watchall": {
        await settingsStore.update({ watchMode: "all" });
        await reply("✅ Mode kembali ke *all* — semua grup diringkas (kecuali yang di-exclude).");
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
