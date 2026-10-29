"""Screen text: every entry in web/src/strings.ts has English, Malay, Chinese and Tamil, and the run-time keys it is looked up by exist."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web" / "src"
SRC = (WEB / "strings.ts").read_text(encoding="utf-8")
ENTRY = re.compile(r"^  '([^']+)': \{(.*?)\},?$(?=\n+  '|\n+  //|\n+\} satisfies)", re.S | re.M)
ENTRIES = {m.group(1): m.group(2) for m in ENTRY.finditer(SRC)}


def test_every_entry_has_four_non_empty_languages():
    assert len(ENTRIES) > 200
    for key, body in ENTRIES.items():
        for lang in ("en", "ms", "zh", "ta"):
            m = re.search(rf"\b{lang}: ('([^']*)'|\(.*?\) => )", body)
            assert m, f"{key}: no {lang}"
            if m.group(2) is not None:
                assert m.group(2).strip(), f"{key}: empty {lang}"


def test_chinese_and_tamil_are_in_their_own_scripts():
    for key, body in ENTRIES.items():
        zh = re.search(r"\bzh: '([^']*)'", body)
        ta = re.search(r"\bta: '([^']*)'", body)
        if zh and not re.fullmatch(r"[A-Za-z0-9 .:+/-]*", zh.group(1)):  # a few labels are names (API, AI)
            assert re.search(r"[一-鿿]", zh.group(1)), f"{key}: zh has no Chinese characters"
        if ta and not re.fullmatch(r"[A-Za-z0-9 .:+/-]*", ta.group(1)):
            assert re.search(r"[஀-௿]", ta.group(1)), f"{key}: ta has no Tamil characters"


def test_run_time_keys_exist():
    shell = (WEB / "Shell.tsx").read_text(encoding="utf-8")
    nav = re.findall(r"\{ key: '([a-z-]+)', label: '[^']+', icon:", shell)
    groups = re.findall(r"\{ label: '([A-Za-z]+)', items: \[", shell)
    assert nav and groups
    ui = (WEB / "ui.tsx").read_text(encoding="utf-8")
    statuses = re.findall(r"(\w+): '[^']+'", ui[ui.index("STATUS_LABEL: Record"):ui.index("export const stageLabel")])
    assert "job_created" in statuses
    want = [f"nav.{k}" for k in nav] + [f"nav.group.{g}" for g in groups] + [f"st.{s}" for s in statuses]
    want += [f"heat.{h}" for h in ("fresh", "waiting", "late", "stale")] + [f"heat.range.{h}" for h in ("fresh", "waiting", "late", "stale")]
    want += [f"jobs.col.{s}" for s in ("todo", "doing", "done")] + [f"jobs.pri.{p}" for p in ("high", "normal", "low")]
    want += [f"act.a.{a}" for a in ("created", "status", "other")] + [f"tr.kind.{k}" for k in ("all", "quote", "supplier_doc", "rfq", "listing")]
    rules = (WEB.parent.parent / "src" / "track_rules.py").read_text(encoding="utf-8")
    want += [f"why.{w}" for w in re.findall(r'return "([a-z /]+)"', rules)]
    missing = [k for k in want if k not in ENTRIES]
    assert not missing, missing
