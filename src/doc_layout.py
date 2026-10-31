"""Layout specs for the customer-facing documents: plain dicts, one default per kind, and the one gate every spec goes through.
validate() is the trust boundary: an owner override or an AI-proposed spec is data from outside, so only the fixed sets below get past it.
Pure functions, no DB. quote_pdf.render() draws a spec. ONE language per business (en, ms, zh, ta), never bilingual."""
import copy

LANGS = ("en", "ms", "zh", "ta")
KINDS = ("quotation", "proforma", "delivery_order", "invoice", "receipt", "credit_note")
BLOCKS = ("header", "parties", "meta", "lines", "totals", "deposit", "terms", "bank", "signature", "chop", "footer")
COLS = ("no", "description", "qty", "uom", "unit_price", "discount", "amount")
PRICE_COLS = ("unit_price", "discount", "amount")  # hidden, with the totals and deposit blocks, when show_prices is false
STYLES = ("simple", "classic", "band")
PAPERS = ("A4",)  # ponytail: the renderer's frame is A4-wide; add a paper size with its own frame width when asked
FONT_SIZE = (7, 14)
REQUIRED = {"kind", "title", "blocks", "columns", "show_prices", "paper", "style", "font_size"}
KEYS = REQUIRED | {"title_sst", "labels", "footer_text"}

_ALL = ("header", "meta", "parties", "lines", "totals", "deposit", "terms", "bank", "signature", "chop", "footer")


def _t(en, ms, zh, ta):
    return dict(zip(LANGS, (en, ms, zh, ta)))


# fixed wording, every language. Tamil and Malay wording is a first draft: have a native reader check it before launch.
WORDS = {
    "subtotal": _t("Subtotal", "Jumlah kecil", "小计", "உப மொத்தம்"),
    "total": _t("Total", "Jumlah", "总计", "மொத்தம்"),
    "sst_est": _t("SST (estimate)", "SST (anggaran)", "SST（预估）", "SST (மதிப்பீடு)"),
    "issued": _t("Issued", "Dikeluarkan", "开具日期", "வழங்கிய தேதி"),
    "valid": _t("Valid until", "Sah sehingga", "有效期至", "செல்லுபடியாகும் வரை"),
    "due": _t("Due date", "Tarikh akhir bayaran", "到期日", "செலுத்த வேண்டிய தேதி"),
    "for": _t("For", "Kepada", "客户", "பெறுநர்"),
    "attn": _t("Attn", "Perhatian", "联系人", "கவனம்"),
    "email": _t("Email", "E-mel", "邮箱", "மின்னஞ்சல்"),
    "tel": _t("Tel", "Tel", "电话", "தொலைபேசி"),
    "pterms": _t("Payment terms", "Terma pembayaran", "付款条款", "கட்டண விதிமுறைகள்"),
    "terms": _t("Terms", "Terma dan syarat", "条款", "விதிமுறைகள்"),
    "bank": _t("Bank details", "Butiran bank", "银行资料", "வங்கி விவரங்கள்"),
    "page": _t("Page {} of {}", "Halaman {} daripada {}", "第 {} 页，共 {} 页", "பக்கம் {} / {}"),
    "not_tax": _t("This is not a tax invoice.", "Ini bukan invois cukai.", "本单据不是税务发票。", "இது வரி இன்வாய்ஸ் அல்ல."),
    "sst_note": _t("SST shown is an estimate; the final amount is confirmed on the tax invoice.",
                   "SST yang ditunjukkan ialah anggaran; jumlah akhir disahkan pada invois cukai.",
                   "所示SST为预估金额，最终金额以税务发票为准。",
                   "காட்டப்பட்ட SST ஒரு மதிப்பீடு; இறுதித் தொகை வரி இன்வாய்ஸில் உறுதிசெய்யப்படும்."),
    "deposit_note": _t("Deposit receipt, not a tax invoice.", "Resit deposit, bukan invois cukai.", "订金收据，非税务发票。",
                       "முன்பணம் ரசீது, வரி இன்வாய்ஸ் அல்ல."),
    "deposit": _t("Deposit", "Deposit", "订金", "முன்பணம்"),
    "deposit_due": _t("Deposit due", "Deposit perlu dibayar", "应付订金", "செலுத்த வேண்டிய முன்பணம்"),
    "deposit_paid": _t("Deposit paid", "Deposit dibayar", "已付订金", "செலுத்திய முன்பணம்"),
    "balance_due": _t("Balance due", "Baki perlu dibayar", "应付余额", "செலுத்த வேண்டிய மீதம்"),
    "balance": _t("Balance", "Baki", "余额", "மீதம்"),
    "received": _t("Amount received", "Jumlah diterima", "收款金额", "பெற்ற தொகை"),
    "method": _t("Method", "Kaedah", "付款方式", "முறை"),
    "reference": _t("Reference", "Rujukan", "参考号", "குறிப்பு எண்"),
    "pay_for": _t("Payment for", "Bayaran untuk", "付款用途", "கட்டணம் எதற்கு"),
    "pay_for_deposit": _t("Deposit", "Deposit", "订金", "முன்பணம்"),
    "pay_for_balance": _t("Balance", "Baki", "余款", "மீதம்"),
    "paid": _t("PAID", "DIBAYAR", "已付清", "செலுத்தப்பட்டது"),
    "good_order": _t("Goods received in good order and condition.", "Barang diterima dalam keadaan baik dan lengkap.",
                     "货物已验收，状态良好、数量无误。", "பொருட்கள் நல்ல நிலையில் பெறப்பட்டன."),
    "sig_name": _t("Name", "Nama", "姓名", "பெயர்"),
    "sig_sign": _t("Signature", "Tandatangan", "签名", "கையொப்பம்"),
    "sig_date": _t("Date", "Tarikh", "日期", "தேதி"),
    "chop": _t("Company chop", "Cop syarikat", "公司印章", "நிறுவன முத்திரை"),
    "do_problems": _t("Reported on receipt", "Dilaporkan semasa penerimaan", "签收时反映的问题", "பெறும்போது தெரிவிக்கப்பட்டது"),
    "invoice_ref": _t("Invoice", "Invois", "发票", "இன்வாய்ஸ்"),
    # shown beside the customer's sign button: says what is recorded and nothing about legal effect
    "do_notice": _t("Typing your name and tapping Sign records your name, the time and a one-way code of your device's network address with this delivery order. "
                    "Tick the box only if you have received the goods listed.",
                    "Menaip nama anda dan menekan Tandatangan akan merekodkan nama anda, masa dan kod sehala bagi alamat rangkaian peranti anda bersama pesanan penghantaran ini. "
                    "Tandakan kotak hanya jika anda telah menerima barang yang disenaraikan.",
                    "输入姓名并点击签收后，系统会记录您的姓名、时间以及设备网络地址的单向代码，并与本送货单一并保存。仅在您已收到所列货物时才勾选。",
                    "உங்கள் பெயரை உள்ளிட்டு கையொப்பமிடு என்பதைத் தட்டினால், உங்கள் பெயர், நேரம், உங்கள் சாதனத்தின் நெட்வொர்க் முகவரியின் ஒருவழிக் குறியீடு ஆகியவை இந்த டெலிவரி ஆர்டருடன் பதிவு செய்யப்படும். "
                    "பட்டியலிடப்பட்ட பொருட்களைப் பெற்றிருந்தால் மட்டுமே பெட்டியைத் தேர்வு செய்யவும்."),
}
LABELS = {
    "no": _t("#", "#", "#", "#"),
    "description": _t("Description", "Perihal", "品名", "விவரம்"),
    "qty": _t("Qty", "Kuantiti", "数量", "அளவு"),
    "uom": _t("Unit", "Unit", "单位", "அலகு"),
    "unit_price": _t("Unit price", "Harga seunit", "单价", "அலகு விலை"),
    "discount": _t("Discount", "Diskaun", "折扣", "தள்ளுபடி"),
    "amount": _t("Amount", "Jumlah", "金额", "தொகை"),
}

_COLS = ["no", "description", "qty", "uom", "unit_price", "amount"]
_BASE = {"show_prices": True, "paper": "A4", "style": "simple", "font_size": 10, "columns": _COLS, "blocks": list(_ALL)}


def _spec(kind, title, **kw):
    return {**copy.deepcopy(_BASE), "kind": kind, "title": title, **kw}


DEFAULTS = {
    "quotation": _spec("quotation", _t("Quotation", "Sebut Harga", "报价单", "விலைப்புள்ளி"),
                       blocks=[b for b in _ALL if b not in ("deposit", "signature", "chop")]),
    "proforma": _spec("proforma", _t("Proforma Invoice", "Invois Proforma", "形式发票", "ப்ரோஃபார்மா இன்வாய்ஸ்"),
                      blocks=[b for b in _ALL if b not in ("signature", "chop")]),
    "delivery_order": _spec("delivery_order", _t("Delivery Order", "Order Penghantaran", "送货单", "டெலிவரி ஆர்டர்"), show_prices=False,
                            blocks=["header", "meta", "parties", "lines", "totals", "signature", "chop", "footer"]),
    "invoice": _spec("invoice", _t("Invoice", "Invois", "发票", "இன்வாய்ஸ்"), title_sst=_t("Tax Invoice", "Invois Cukai", "税务发票", "வரி இன்வாய்ஸ்"),
                     blocks=[b for b in _ALL if b not in ("signature", "chop")]),
    "receipt": _spec("receipt", _t("Receipt", "Resit", "收据", "ரசீது"), blocks=["header", "meta", "parties", "deposit", "footer"]),
    "credit_note": _spec("credit_note", _t("Credit Note", "Nota Kredit", "贷项通知单", "கிரெடிட் நோட்"), blocks=["header", "meta", "parties", "lines", "totals", "footer"]),
}


def default_spec(kind: str) -> dict:
    if kind not in DEFAULTS:
        raise ValueError(f"unknown document kind: {kind!r}")
    return copy.deepcopy(DEFAULTS[kind])


def _text(v, what, n, nl=False):
    if not isinstance(v, str) or not 0 < len(v.strip()) <= n or any(ord(c) < 32 and not (nl and c == "\n") for c in v):
        raise ValueError(f"{what}: text of 1 to {n} characters, no control characters")
    return v


def _words(v, what, n):
    if not isinstance(v, dict) or not v or not set(v) <= set(LANGS):
        raise ValueError(f"{what}: a dict keyed by {LANGS}")
    return {k: _text(x, f"{what}.{k}", n) for k, x in v.items()}


def _pick(v, allowed, what, max_n):
    if not isinstance(v, list) or len(v) > max_n or len(set(map(str, v))) != len(v) or not all(isinstance(x, str) and x in allowed for x in v):
        raise ValueError(f"{what}: a list of distinct names from {allowed}")
    return list(v)


def validate(spec) -> dict:
    """The clean copy of spec, or ValueError. Only the allowed keys, blocks, columns, styles and sizes survive; nothing is passed through."""
    if not isinstance(spec, dict) or not REQUIRED <= set(spec) or not set(spec) <= KEYS:
        raise ValueError(f"layout: a dict with keys {sorted(REQUIRED)} and optionally {sorted(KEYS - REQUIRED)}")
    if spec["kind"] not in KINDS:
        raise ValueError(f"kind: one of {KINDS}")
    for k, allowed in (("paper", PAPERS), ("style", STYLES)):
        if spec[k] not in allowed:
            raise ValueError(f"{k}: one of {allowed}")
    if spec["show_prices"] is not True and spec["show_prices"] is not False:
        raise ValueError("show_prices: true or false")
    fs = spec["font_size"]
    if isinstance(fs, bool) or not isinstance(fs, (int, float)) or not FONT_SIZE[0] <= fs <= FONT_SIZE[1]:
        raise ValueError(f"font_size: a number from {FONT_SIZE[0]} to {FONT_SIZE[1]}")
    out = {"kind": spec["kind"], "paper": spec["paper"], "style": spec["style"], "show_prices": spec["show_prices"], "font_size": fs,
           "title": _words(spec["title"], "title", 60), "blocks": _pick(spec["blocks"], BLOCKS, "blocks", len(BLOCKS)),
           "columns": _pick(spec["columns"], COLS, "columns", len(COLS))}
    if "title_sst" in spec:
        out["title_sst"] = _words(spec["title_sst"], "title_sst", 60)
    if "footer_text" in spec:
        out["footer_text"] = _text(spec["footer_text"], "footer_text", 300, nl=True)
    if "labels" in spec:
        lb = spec["labels"]
        if not isinstance(lb, dict) or not set(lb) <= set(COLS):
            raise ValueError(f"labels: a dict keyed by {COLS}")
        out["labels"] = {k: _words(v, f"labels.{k}", 30) for k, v in lb.items()}
    return out


def merge(default: dict, override: dict | None) -> dict:
    """default with the owner's (or the AI's proposed) override on top, then validated. title, title_sst and labels merge per language;
    every other key is replaced whole. The kind cannot change."""
    if override is None:
        return validate(default)
    if not isinstance(override, dict):
        raise ValueError("layout override: a dict")
    out = {**default, **override}
    for k in ("title", "title_sst"):
        if k in override:
            out[k] = {**default.get(k, {}), **override[k]} if isinstance(override[k], dict) else override[k]
    if isinstance(override.get("labels"), dict):  # per column, per language
        d = default.get("labels", {})
        out["labels"] = {c: {**d.get(c, {}), **w} if isinstance(w, dict) else w for c, w in override["labels"].items()} | {c: w for c, w in d.items() if c not in override["labels"]}
    if out.get("kind") != default["kind"]:
        raise ValueError("kind cannot be changed by an override")
    return validate(out)


def title(spec: dict, lang: str, sst_registered: bool) -> str:
    """The heading in the business's language; an invoice from an SST-registered issuer is a Tax Invoice."""
    return (spec.get("title_sst") if sst_registered and "title_sst" in spec else spec["title"]).get(lang) or spec["title"].get(lang) or spec["title"]["en"]


def label(spec: dict, col: str, lang: str) -> str:
    return spec.get("labels", {}).get(col, {}).get(lang) or LABELS[col][lang]
