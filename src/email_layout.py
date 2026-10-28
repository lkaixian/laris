"""Transactional email layout: render(...) -> (text, html). Stdlib only, table based, inline styles plus one small <style> block.
Colours are the theme.css tokens (green accent, never amber). Blocks: ("p", s) ("code", s, note) ("facts", [(label, value)])
("table", [header], [[cell]]) ("button", label, url) ("note", s). Subjects are built by the callers, never here."""
import re
import textwrap
from html import escape

# (fg, bg) pairs in use, checked >= 4.5:1 by tests/test_email_layout.py
PAIRS = {
    "light": {"ink/surface": ("#16231d", "#ffffff"), "muted/surface": ("#475a50", "#ffffff"), "accent/surface": ("#0f5c47", "#ffffff"),
              "ink/tint": ("#16231d", "#e1f0e8"), "muted/tint": ("#475a50", "#e1f0e8"), "accent/tint": ("#0f5c47", "#e1f0e8"),
              "on-accent/accent": ("#ffffff", "#0f5c47"), "muted/bg": ("#475a50", "#f4f8f5")},
    "dark": {"ink/surface": ("#f3f1e6", "#12251e"), "muted/surface": ("#a9bbb1", "#12251e"), "accent/surface": ("#45b98d", "#12251e"),
             "ink/tint": ("#f3f1e6", "#1a3a2f"), "muted/tint": ("#a9bbb1", "#1a3a2f"), "accent/tint": ("#45b98d", "#1a3a2f"),
             "on-accent/accent": ("#06140f", "#45b98d"), "muted/bg": ("#a9bbb1", "#0b1914")},
}
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
WRAP = "word-break:break-word;overflow-wrap:anywhere;"
# dark rules need !important to beat the inline styles
CSS = ("@media (max-width:620px){.w{width:100%!important}.g{padding-left:16px!important;padding-right:16px!important}"
       ".b,.b a{display:block!important;width:100%!important;box-sizing:border-box}}"
       "@media (prefers-color-scheme:dark){.bg{background:#0b1914!important}.sf{background:#12251e!important}"
       ".tn{background:#1a3a2f!important}.ink{color:#f3f1e6!important}.mu{color:#a9bbb1!important}.ac{color:#45b98d!important}"
       ".bt{background:#45b98d!important}.bt a{color:#06140f!important}.ln{border-color:#6f8a7d!important}}")


def _url(u) -> str | None:
    return u if isinstance(u, str) and re.fullmatch(r"https?://[^\s\"'<>]+", u) else None


def _p(s: str, style: str = "", cls: str = "ink") -> str:
    return f'<p class="{cls}" style="margin:0 0 16px;{WRAP}{style}">{escape(s)}</p>'


def _html_block(b) -> str:
    k = b[0]
    if k == "p":
        return _p(b[1], "font-size:16px;line-height:1.5;color:#16231d;")
    if k == "note":
        return _p(b[1], "font-size:13px;line-height:1.5;color:#475a50;", "mu")
    if k == "code":
        note = _p(b[2], "font-size:13px;line-height:1.5;color:#475a50;margin:8px 0 0;", "mu") if b[2] else ""
        return (f'<div class="tn" style="background:#e1f0e8;border-radius:8px;padding:20px 16px;margin:0 0 16px;text-align:center">'
                f'<div class="ink" style="font-family:{MONO};font-size:32px;line-height:1.2;font-weight:600;letter-spacing:8px;'
                f'font-variant-numeric:tabular-nums;color:#16231d;{WRAP}">{escape(b[1])}</div>{note}</div>')
    if k == "facts":
        rows = "".join(f'<tr><td class="mu" style="padding:6px 12px 6px 0;font-size:14px;line-height:1.5;color:#475a50;vertical-align:top">{escape(a)}</td>'
                       f'<td class="ink" style="padding:6px 0;font-size:16px;line-height:1.5;font-weight:600;color:#16231d;{WRAP}">{escape(v)}</td></tr>'
                       for a, v in b[1])
        return (f'<table role="presentation" class="tn" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e1f0e8;'
                f'border-radius:8px;margin:0 0 16px"><tr><td style="padding:12px 16px"><table role="presentation" cellpadding="0" '
                f'cellspacing="0" border="0" width="100%">{rows}</table></td></tr></table>')
    if k == "table":
        th = "".join(f'<th class="mu ln" align="left" style="padding:8px 8px 8px 0;font-size:13px;line-height:1.4;font-weight:600;color:#475a50;'
                     f'border-bottom:1px solid #6a7d72">{escape(h)}</th>' for h in b[1])
        tr = "".join("<tr>" + "".join(f'<td class="ink ln" style="padding:8px 8px 8px 0;font-size:14px;line-height:1.4;color:#16231d;'
                                      f'border-bottom:1px solid #dce7e0;vertical-align:top;{WRAP}">{escape(c)}</td>' for c in r) + "</tr>"
                     for r in b[2])
        return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;table-layout:fixed"><tr>{th}</tr>{tr}</table>'
    if k == "button":
        u = _url(b[2])
        if not u:
            return _p(b[1])
        return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px"><tr>'
                f'<td class="b bt" bgcolor="#0f5c47" style="background:#0f5c47;border-radius:8px;text-align:center">'
                f'<a href="{escape(u)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;'
                f'text-decoration:underline">{escape(b[1])}</a></td></tr></table>'
                + _p(u, "font-size:12px;line-height:1.5;color:#475a50;", "mu"))
    raise ValueError(f"unknown block {k!r}")


def _text_block(b) -> str:
    k = b[0]
    fill = lambda s, **kw: textwrap.fill(s, 72, break_long_words=False, break_on_hyphens=False, **kw)
    if k in ("p", "note"):
        return fill(b[1])
    if k == "code":
        return f"    {b[1]}" + (f"\n{fill(b[2])}" if b[2] else "")
    if k == "facts":
        w = max((len(a) for a, _ in b[1]), default=0)
        return "\n".join(f"{a + ':':<{w + 1}} {v}" for a, v in b[1])
    if k == "table":
        rows = [b[1], *b[2]]
        w = [max(len(str(r[i])) for r in rows if i < len(r)) for i in range(len(b[1]))]
        return "\n".join("  ".join(f"{str(c):<{w[i]}}" for i, c in enumerate(r)).rstrip() for r in rows)
    if k == "button":
        u = _url(b[2])
        return f"{b[1]}: {u}" if u else b[1]
    raise ValueError(f"unknown block {k!r}")


def render(*, title: str, preheader: str, blocks: list, brand: str = "LARIS", via: str | None = None, footer: str,
           base_url: str | None = None) -> tuple[str, str]:
    """(text, html). Every string is escaped; only http(s) URLs become links or images."""
    base = _url(base_url)
    logo = (f'<img src="{escape(base.rstrip("/"))}/brand/laris-logo.png" alt="{escape(brand)}" width="32" height="32" '
            f'style="vertical-align:middle;border:0;margin-right:8px"> ') if base else ""
    vialine = f'<div class="mu" style="font-size:12px;line-height:1.5;color:#475a50">{escape(via)}</div>' if via else ""
    body = "".join(_html_block(b) for b in blocks)
    html = (f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
            f'<title>{escape(title)}</title><style>{CSS}</style></head>'
            f'<body class="bg" style="margin:0;padding:0;background:#f4f8f5;font-family:{FONT}">'
            f'<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f8f5">{escape(preheader)}'
            f'{"&nbsp;&zwnj;" * 40}</span>'
            f'<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8f5"><tr>'
            f'<td align="center" style="padding:24px 0">'
            f'<table role="presentation" class="w sf" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;'
            f'background:#ffffff;border-radius:8px"><tr><td class="g" style="padding:24px 32px 8px">'
            f'<div class="ac" style="font-size:22px;line-height:1.3;font-weight:600;color:#0f5c47;{WRAP}">{logo}{escape(brand)}</div>{vialine}</td></tr>'
            f'<tr><td class="g" style="padding:16px 32px 8px"><h1 class="ink" style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;'
            f'color:#16231d;{WRAP}">{escape(title)}</h1>{body}</td></tr>'
            f'<tr><td class="g" style="padding:8px 32px 24px"><p class="mu" style="margin:0;font-size:12px;line-height:1.5;color:#475a50;{WRAP}">'
            f'{escape(footer)}</p></td></tr></table></td></tr></table></body></html>')
    head = brand + (f" ({via})" if via else "")
    text = "\n\n".join([head, title, *(_text_block(b) for b in blocks), footer]) + "\n"
    return text, html
