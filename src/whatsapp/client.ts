import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type proto,
} from "baileys";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { messageStore, type StoredMessage } from "../store/messageStore.js";
import { settingsStore } from "../store/settings.js";
import { summarizeGroup } from "../summary/summarizer.js";
import { handleCommand } from "./commands.js";

/** Ambil statusCode dari error Boom Baileys tanpa import @hapi/boom. */
function getStatusCode(err: unknown): number | undefined {
  return (err as { output?: { statusCode?: number } })?.output?.statusCode;
}

/** messageTimestamp bisa berupa number atau Long (long.js). Normalisasi ke epoch ms. */
function tsToMillis(ts: WAMessage["messageTimestamp"]): number {
  if (ts == null) return Date.now();
  const seconds =
    typeof ts === "number"
      ? ts
      : typeof ts.toNumber === "function"
        ? ts.toNumber()
        : Number(ts);
  return (Number.isFinite(seconds) ? seconds : Date.now() / 1000) * 1000;
}

/** Normalisasi isi pesan dari berbagai tipe menjadi teks. */
function extractText(message: proto.IMessage | null | undefined): string {
  if (!message) return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    ""
  ).trim();
}

export class WagBot {
  private sock: WASocket | null = null;

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ["WagAgent", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info("Scan QR berikut dengan WhatsApp (Linked devices):");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        logger.info("✅ Terhubung ke WhatsApp.");
      }

      if (connection === "close") {
        const code = getStatusCode(lastDisconnect?.error);
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn(
          { code },
          loggedOut
            ? "Sesi logout. Hapus folder auth dan scan ulang QR."
            : "Koneksi terputus, mencoba menyambung ulang...",
        );
        if (!loggedOut) {
          setTimeout(() => void this.connect(), 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        void this.onMessage(msg);
      }
    });
  }

  private async onMessage(msg: WAMessage): Promise<void> {
    if (!msg.message || msg.key.remoteJid === "status@broadcast") return;

    const remoteJid = msg.key.remoteJid ?? "";
    const isGroup = remoteJid.endsWith("@g.us");
    const text = extractText(msg.message);
    const fromMe = Boolean(msg.key.fromMe);
    const senderJid = isGroup ? msg.key.participant ?? "" : remoteJid;
    const senderName = msg.pushName ?? "";

    // 1) Perintah dengan prefix "!".
    if (text.startsWith(config.commandPrefix)) {
      if (this.isAuthorized(fromMe, senderJid)) {
        await handleCommand(this, {
          chatJid: remoteJid,
          isGroup,
          args: text.slice(config.commandPrefix.length).trim().split(/\s+/),
          raw: text,
        });
      } else {
        logger.debug({ senderJid }, "Perintah diabaikan (tidak diizinkan).");
      }
      return;
    }

    // 2) Simpan pesan grup untuk bahan ringkasan (abaikan pesan kosong & dari diri sendiri).
    if (isGroup && text && !fromMe) {
      const stored: StoredMessage = {
        sender: senderJid,
        senderName,
        text,
        ts: tsToMillis(msg.messageTimestamp),
      };
      messageStore.add(remoteJid, stored);
      void this.cacheGroupName(remoteJid);
    }
  }

  /** Apakah pengirim boleh menjalankan perintah. */
  private isAuthorized(fromMe: boolean, senderJid: string): boolean {
    if (fromMe) return true;
    if (config.ownerJids.length === 0) return false;
    const num = senderJid.split("@")[0]?.split(":")[0] ?? "";
    return config.ownerJids.some((o) => o.replace(/\D/g, "") === num.replace(/\D/g, ""));
  }

  /** Simpan nama grup ke cache (sekali per grup, lazy). */
  private async cacheGroupName(groupJid: string): Promise<void> {
    if (messageStore.getGroupName(groupJid) !== groupJid) return; // sudah ada
    try {
      const meta = await this.sock?.groupMetadata(groupJid);
      if (meta?.subject) messageStore.setGroupName(groupJid, meta.subject);
    } catch {
      /* abaikan bila gagal ambil metadata */
    }
  }

  /** Ambil SEMUA grup yang diikuti akun ini (langsung dari WhatsApp). */
  async listAllGroups(): Promise<{ jid: string; subject: string }[]> {
    if (!this.sock) throw new Error("Socket belum siap.");
    const all = await this.sock.groupFetchAllParticipating();
    const groups = Object.values(all).map((g) => ({
      jid: g.id,
      subject: g.subject || g.id,
    }));
    // Cache sekalian supaya nama grup langsung tersedia untuk ringkasan.
    for (const g of groups) messageStore.setGroupName(g.jid, g.subject);
    return groups.sort((a, b) => a.subject.localeCompare(b.subject));
  }

  getOwnJid(): string {
    return this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : "";
  }

  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("Socket belum siap.");
    await this.sock.sendMessage(jid, { text });
  }

  /**
   * Ringkas satu grup lalu kirim ke `replyTo`.
   * windowHours = rentang waktu pesan yang diringkas (default 24 jam).
   */
  async summarizeSingle(
    groupJid: string,
    replyTo: string,
    windowHours = 24,
  ): Promise<void> {
    const settings = settingsStore.get();
    const since = Date.now() - windowHours * 3600_000;
    const messages = messageStore.getMessagesSince(groupJid, since);
    const name = messageStore.getGroupName(groupJid);

    await this.sendText(replyTo, `📋 *Ringkasan grup: ${name}*\n_(${messages.length} pesan, ${windowHours} jam terakhir)_`);
    const summary = await summarizeGroup(name, messages, settings.language);
    await this.sendText(replyTo, summary);
  }

  /**
   * Ringkas SEMUA grup (kecuali yang di-exclude) lalu kirim ke target.
   * Dipakai oleh penjadwal harian dan perintah "!summary all".
   */
  async runSummaries(windowHours = 24): Promise<void> {
    const settings = settingsStore.get();
    const target = settings.summaryTarget || this.getOwnJid();
    if (!target) {
      logger.error("Target ringkasan tidak diketahui (own JID kosong).");
      return;
    }

    const groups =
      settings.watchMode === "whitelist"
        ? // Hanya grup yang di-whitelist (walau belum ada pesan tersimpan).
          settings.whitelistGroups
        : // Semua grup yang punya aktivitas, kecuali yang di-exclude.
          messageStore
            .listGroups()
            .filter((jid) => !settings.excludedGroups.includes(jid));

    if (groups.length === 0) {
      await this.sendText(
        target,
        settings.language === "id"
          ? "Belum ada aktivitas grup untuk diringkas."
          : "No group activity to summarize yet.",
      );
      return;
    }

    const header =
      settings.language === "id"
        ? `🌙 *Ringkasan Harian WagAgent*\n${new Date().toLocaleString("id-ID", { timeZone: settings.timezone })}\nMeringkas ${groups.length} grup...`
        : `🌙 *WagAgent Daily Summary*\n${new Date().toLocaleString("en-US", { timeZone: settings.timezone })}\nSummarizing ${groups.length} groups...`;
    await this.sendText(target, header);

    const since = Date.now() - windowHours * 3600_000;
    for (const jid of groups) {
      const name = messageStore.getGroupName(jid);
      const messages = messageStore.getMessagesSince(jid, since);
      const summary = await summarizeGroup(name, messages, settings.language);
      await this.sendText(target, `*📋 ${name}*\n${summary}`);
    }

    messageStore.prune();
  }
}
