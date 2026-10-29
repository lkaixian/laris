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
