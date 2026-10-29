"""The customer bot's fixed texts (English and Malay), the owner's bot settings and the reply type. Re-exported by webhooks.py."""
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
            "notice": "Privacy notice: we keep the messages you send us and the quotes we prepare for you, so we can serve you. Voice notes are transcribed "
                      "and the audio is not kept. The business and its team can see this, and the services that run our chat and AI reading process it for us.{dpo}\n"
                      "By continuing to message us you accept this. Send /privacy to read this again, /mydata to get a copy of your data, "
                      "or /forget to ask us to erase it.",
            "dpo": " For questions, contact our data protection contact: {who}.",
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
            "notice": "Notis privasi: kami menyimpan mesej yang anda hantar dan sebut harga yang kami sediakan untuk anda, supaya kami dapat melayan anda. "
                      "Nota suara ditranskripsi dan audio tidak disimpan. Perniagaan ini dan pasukannya boleh melihatnya, dan perkhidmatan yang menjalankan "
                      "sembang dan bacaan AI kami memprosesnya bagi pihak kami.{dpo}\n"
                      "Dengan terus menghantar mesej kepada kami, anda bersetuju. Hantar /privacy untuk baca semula, /mydata untuk salinan data anda, "
                      "atau /forget untuk meminta kami memadamnya.",
            "dpo": " Untuk pertanyaan, hubungi pegawai perlindungan data kami: {who}.",
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
