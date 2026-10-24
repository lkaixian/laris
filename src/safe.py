"""One spreadsheet formula-injection guard for every CSV / XLSX cell that carries user- or supplier-controlled text."""


def safe(v):
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
