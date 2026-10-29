"""Small pure helpers shared by the pipeline modules: tolerant number/date parsing and PII redaction."""
import re
from datetime import date
from decimal import Decimal, InvalidOperation

BIG = Decimal(10) ** 10


PII = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}"                       # email
                 r"|(?<!\d)(?:\+?60|0)1\d[ -]?\d{3,4}[ -]?\d{4}(?!\d)"       # Malaysian mobile
                 r"|(?<!\d)\d{6}-?\d{2}-?\d{4}(?!\d)")                       # NRIC


def redact(text: str) -> str:
    """Strip contact details and NRIC numbers before text leaves for the LLM (PDPA cross-border transfer).
    Prices, quantities and document numbers are untouched. ponytail: regex only; names and addresses pass through."""
    return PII.sub("[redacted]", text)

CARD = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")  # 13 to 19 digits, kept only when the Luhn check passes
TOKEN = re.compile(r"\[(EMAIL|PHONE|ID|CARD)_(\d+)\]")


def _luhn(s: str) -> bool:
    d = [int(c) for c in s if c.isdigit()][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(2 * x, 10)) for x in d[1::2])) % 10 == 0


class Mask:
    """Reversible masking for one model call: PII becomes [EMAIL_1], [PHONE_1], [ID_1], [CARD_1] (the same value always gets the same
    token) and unmask() puts the real values back into the reply. The map lives only in this object, never stored or logged.
    ponytail: regex only, names and addresses pass through until the contacts dictionary is wired in."""

    def __init__(self):
        self.seen = {}  # token -> original

    def _tok(self, kind: str, v: str) -> str:
        for t, o in self.seen.items():
            if o == v and t.startswith(f"[{kind}_"):
                return t
        t = f"[{kind}_{sum(k.startswith(f'[{kind}_') for k in self.seen) + 1}]"
        self.seen[t] = v
        return t

    def __call__(self, text: str) -> str:
        text = CARD.sub(lambda m: self._tok("CARD", m[0]) if _luhn(m[0]) else m[0], text)
        return PII.sub(lambda m: self._tok("EMAIL" if "@" in m[0] else "ID" if re.fullmatch(r"\d{6}-?\d{2}-?\d{4}", m[0]) else "PHONE", m[0]), text)

    def unmask(self, x):
        if isinstance(x, str):
            return TOKEN.sub(lambda m: self.seen.get(m[0], m[0]), x)
        if isinstance(x, list):
            return [self.unmask(i) for i in x]
        if isinstance(x, dict):
            return {k: self.unmask(v) for k, v in x.items()}
        return x


def _dec(x, lo=Decimal(0)):
    if x is None or isinstance(x, bool):
        return None
    try:
        d = Decimal(str(x).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() and lo <= d < BIG else None


def _date(s):
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None
