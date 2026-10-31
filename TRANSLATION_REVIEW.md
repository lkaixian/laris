# TRANSLATION_REVIEW (3D printing edition)

Every string below was **drafted by the assistant, not by a native speaker**. English is the source. Malay, Chinese (Simplified, Malaysian usage) and Tamil need a native reader before release. Where an existing LARIS term already exists in `web/src/strings.ts` it was reused instead of re-translated.

Status key: **A** drafted, needs native review. **B** reused from existing LARIS strings (already reviewed upstream).

## Appearance (Settings, `web/src/App.tsx`)

| Key | English | Malay | Chinese | Tamil | Status |
|---|---|---|---|---|---|
| system | System | Sistem | 跟随系统 | சாதனம் | A. Tamil: consider "கணினி/சாதன அமைப்பு"; the short word may be too vague |
| reduceTransparency | Reduce transparency | Kurangkan kelutsinaran | 减少透明效果 | ஒளிஊடுருவலைக் குறைக்கவும் | A |
| reduceTransparencyHint | Solid panels instead of frosted glass. Also on when your device asks for less transparency. | Panel pepejal, bukan kaca berfros. Turut aktif jika peranti anda meminta kurang kelutsinaran. | 用实色面板代替磨砂玻璃。当设备要求减少透明效果时也会自动启用。 | (see file) | A. "Frosted glass" is a design metaphor: check it reads naturally in each language |
| liteVisuals | Lite visuals | Visual ringan | 精简视觉效果 | எளிய காட்சிகள் | A |
| liteVisualsHint | Stops the moving background and softens the blur. Helps on older phones. | Hentikan latar bergerak dan kurangkan kabur. Membantu pada telefon lama. | 停止动态背景并减弱模糊效果，适合较旧的手机。 | (see file) | A |

## Bento layout editing (`web/src/Bento.tsx`)

| Key | English | Malay | Chinese | Tamil |
|---|---|---|---|---|
| edit | Edit layout | Ubah susun atur | 编辑布局 | அமைப்பைத் திருத்து |
| done | Done | Selesai | 完成 | முடிந்தது |
| reset | Reset layout | Tetapkan semula susun atur | 重置布局 | அமைப்பை மீட்டமை |
| preset | Layout | Susun atur | 布局方案 | அமைப்பு |
| custom | Custom | Tersuai | 自定义 | தனிப்பயன் |
| earlier / later | Move earlier / later | Alih ke depan / belakang | 前移 / 后移 | முன்னே / பின்னே நகர்த்து |
| size | Change size | Tukar saiz | 更改大小 | அளவை மாற்று |
| hide / show | Hide this tile / Show | Sembunyikan jubin ini / Tunjuk | 隐藏此卡片 / 显示 | இந்த ஓட்டை மறை / காட்டு |
| hiddenTitle | Hidden tiles | Jubin tersembunyi | 已隐藏的卡片 | மறைக்கப்பட்ட ஓடுகள் |
| Sizes | Small / Medium / Large / Extra large | Kecil / Sederhana / Besar / Sangat besar | 小 / 中 / 大 / 特大 | சிறியது / நடுத்தரம் / பெரியது / மிகப் பெரியது |
| Presets | Owner / Operator / Accountant / Everything | Pemilik / Operator / Akauntan / Semua | 老板 / 操作员 / 会计 / 全部 | உரிமையாளர் / இயக்குநர் / கணக்காளர் / அனைத்தும் |

Status for all rows: **A**. Points to check:
- **"Tile"** (a card on the dashboard): Malay "jubin" (literally a floor tile) and Tamil "ஓடு" are literal. A shop owner may prefer "kad" / "பலகை". Chinese "卡片" is natural.
- **Spoken announcements** (screen readers) use sentences built with a number and a name ("Needs a person is now 2 of 9."). Word order differs by language; the four versions are in `Bento.tsx` (`commit`). Please check each reads naturally when spoken.
- **Operator** in Tamil: "இயக்குநர்" can also mean "director". If that confuses, use a phrase meaning "machine operator".

## Not yet translated (3D printing features that are not built)

The glossary in the brief (Quotation, Purchase Order, Proforma, Delivery Order, Receipt, Deposit, Filament, Print job, Layer height, Infill, "Needs your approval") is **not yet in the app**, because the screens that use those words are not built yet. The STL and price engine return **stable codes** (`holes`, `check_unit`, `below_margin_floor`, `turn_to_fit`, `no_printer_fits`, and so on) so the screens can translate them. They are listed in `src/print3d/stl.py` and `src/print3d/pricing.py`.

## Checks done and not done

- Done: all four languages are present for every new key (TypeScript requires `Text` objects; `tests/test_strings.py` still passes).
- Not done: native-speaker review, and a 40% text-expansion layout check (the edit toolbar wraps, which was seen at phone width in English only).
- Not done: Noto Sans fonts for Tamil and Chinese on the web page (the PDF already embeds them; the web app uses the system font stack).
