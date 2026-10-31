"""The customer bot's fixed texts (English and Malay), the owner's bot settings and the reply type. Re-exported by webhooks.py."""
import os
import re

HELP = ("Hi! Send what you need in a message or a voice note, for example \"50 kg PLA, how much?\", and we will send you a quote.\n"
        "Staff: forward a supplier PDF or photo to record its prices, or send a product photo with the caption /catalog.")
SORRY = "Sorry, we could not process that message. Our team will follow up."
VOICE_SORRY = "Sorry, I could not hear that clearly. Please send the voice note again, or type your request."
# The fixed customer-facing strings, English and Malay (the owner picks the language, or "auto" follows the customer's words).
T = {"en": {"welcome": HELP, "help": HELP, "sorry": SORRY, "voice": VOICE_SORRY,
            "noted": "Noted, thank you. We will confirm {doc} with you shortly.",
            "received": "Received {doc}; it is queued for review.", "doc": "your document",
            "thanks": "Thanks, we received your enquiry ({doc}). We will send your quote shortly.",
            "clarify": "Sorry, we could not tell what you need or how many. We quote for: {names}. Please reply with the item and quantity.",
            "after": "We are closed right now. We will reply when we open.",
            "notice": "Privacy notice: to answer your enquiry and prepare your quote we collect your name, your chat number or ID, the messages and voice notes you send, "
                      "and the quotes we prepare for you. Giving us this is voluntary, but we cannot quote without it. Chat text is kept for {days} days; quotes are kept as business records. "
                      "Voice notes are transcribed and the audio is not kept by us. The business and its team can see your data. The services that run our chat, "
                      "AI reading, email and hosting process it for us, and some of them are outside Malaysia.{dpo}\n"
                      "Your choices: send /mydata for a copy of your data, /forget to ask us to erase it, or tell us here to correct it or to limit how we use it. "
                      "Send /privacy to read this again.",
            "limit": "Thanks for your message. Our assistant is at its limit for now, so a person on the team will reply to you.",
            "dpo": " For questions, contact our data protection contact: {who}.",
            "agree": "To continue, reply YES.", "agreed": "Thank you. Please send your request.",
            "forget": "We received your request. The business will confirm after checking quotes it must keep.",
            "erased": "Your data has been erased.",
            "kept": "The business could not erase your data because it must keep some records.{dpo}",
            "mydata": "A copy of the data we hold about you.",
            "mydata_fail": "Sorry, we could not send your data file. Please try again later or contact the business."},
     "ms": {"welcome": "Hai! Hantar apa yang anda perlukan dalam mesej atau nota suara, contohnya \"50 kg PLA, berapa harga?\", dan kami akan hantar sebut harga.\n"
                       "Staf: majukan PDF atau gambar pembekal untuk merekod harganya, atau hantar gambar produk dengan kapsyen /catalog.",
            "sorry": "Maaf, kami tidak dapat memproses mesej itu. Pasukan kami akan menghubungi anda.",
            "voice": "Maaf, saya tidak dapat mendengar nota suara itu dengan jelas. Sila hantar semula, atau taip permintaan anda.",
            "noted": "Baik, terima kasih. Kami akan sahkan {doc} dengan anda tidak lama lagi.",
            "received": "{doc} telah diterima dan sedang menunggu semakan.", "doc": "Dokumen anda",
            "thanks": "Terima kasih, pertanyaan anda ({doc}) telah kami terima. Kami akan hantar sebut harga tidak lama lagi.",
            "clarify": "Maaf, kami tidak pasti apa yang anda perlukan atau berapa banyak. Kami beri sebut harga untuk: {names}. Sila balas dengan item dan kuantiti.",
            "after": "Kami sudah tutup sekarang. Kami akan balas apabila kedai dibuka semula.",
            "notice": "Notis privasi: untuk menjawab pertanyaan anda dan menyediakan sebut harga, kami mengumpul nama anda, nombor atau ID sembang anda, mesej dan nota suara "
                      "yang anda hantar, serta sebut harga yang kami sediakan untuk anda. Memberi maklumat ini adalah sukarela, tetapi kami tidak dapat memberi sebut harga tanpanya. "
                      "Teks sembang disimpan selama {days} hari; sebut harga disimpan sebagai rekod perniagaan. Nota suara ditranskripsi dan audio tidak disimpan oleh kami. "
                      "Perniagaan ini dan pasukannya boleh melihat data anda. Perkhidmatan yang menjalankan sembang, bacaan AI, e-mel dan pengehosan kami memprosesnya "
                      "bagi pihak kami, dan sebahagiannya berada di luar Malaysia.{dpo}\n"
                      "Pilihan anda: hantar /mydata untuk salinan data anda, /forget untuk meminta kami memadamnya, atau beritahu kami di sini untuk membetulkannya "
                      "atau menghadkan cara kami menggunakannya. Hantar /privacy untuk baca semula.",
            "limit": "Terima kasih atas mesej anda. Pembantu kami telah mencapai had buat masa ini, jadi seseorang daripada pasukan akan membalas anda.",
            "dpo": " Untuk pertanyaan, hubungi pegawai perlindungan data kami: {who}.",
            "agree": "Untuk meneruskan, balas YA.", "agreed": "Terima kasih. Sila hantar permintaan anda.",
            "forget": "Kami telah menerima permintaan anda. Perniagaan akan mengesahkan selepas menyemak sebut harga yang mesti disimpan.",
            "erased": "Data anda telah dipadam.",
            "kept": "Perniagaan tidak dapat memadam data anda kerana ada rekod yang mesti disimpan.{dpo}",
            "mydata": "Salinan data anda yang kami simpan.",
            "mydata_fail": "Maaf, kami tidak dapat menghantar fail data anda. Sila cuba lagi nanti atau hubungi perniagaan."}}
T["ms"]["help"] = T["ms"]["welcome"]
SORRYS = {t[k] for t in T.values() for k in ("sorry", "voice")}
MALAY = {"nak", "ada", "tak", "tidak", "berapa", "tolong", "harga", "boleh", "saya", "kita", "kami", "terima", "kasih", "mahu", "hendak", "tempah", "sila", "untuk"}
AH = {"enabled": False, "message": "", "open": "09:00", "close": "18:00", "days": [1, 2, 3, 4, 5, 6, 7]}  # days: ISO weekdays, Monday = 1
NO_ROW = {"welcome": None, "help": None, "language": "auto", "quick_replies": [], "after_hours": AH, "reactions": True}


class Reply(str):
    """Reply text that also carries a Telegram reply keyboard (the /start welcome), or a file to send with the text as its caption
    (document = (bytes, file name, text to send instead if the file cannot be sent))."""
    markup = None
    document = None


def bot_settings(conn, tid) -> dict:
    """The owner's customisation of the customer bot (tenant_bot_settings); no row = the defaults."""
    row = conn.execute("select welcome, help, language, quick_replies, after_hours, reactions from tenant_bot_settings where tenant_id=%s", (tid,)).fetchone()
    return {**row, "after_hours": {**AH, **row["after_hours"]}} if row else NO_ROW


def _lang(cfg, text) -> str:
    if cfg["language"] != "auto":
        return cfg["language"]
    return "ms" if MALAY & set(re.findall(r"[a-z]+", (text or "").lower())) else "en"


def dpo_line(conn, tid, lang) -> str:
    """The data protection contact for a customer-facing text, or "" when the owner has not set one."""
    row = conn.execute("select dpo_name, dpo_email, dpo_phone from tenant_privacy where tenant_id=%s", (tid,)).fetchone()
    who = ", ".join(x for x in (row or {}).values() if x)
    return T[lang]["dpo"].format(who=who) if who else ""


def notice_text(conn, tid) -> str:
    """The privacy notice in both national languages at once (Act 709 s.7(3): Malay and English), English first."""
    days = os.environ.get("RETENTION_DAYS", "180")
    return "\n\n".join(T[l]["notice"].format(dpo=dpo_line(conn, tid, l), days=days) for l in ("en", "ms"))
