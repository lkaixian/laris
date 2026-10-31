# TRANSLATION_REVIEW (3D printing edition)

Every string below was **drafted by the assistant, not by a native speaker**. English is the source. Malay, Chinese (Simplified, Malaysian usage) and Tamil need a native reader before release. Where an existing LARIS term already exists in `web/src/strings.ts` it was reused instead of re-translated.

Status key: **A** drafted, needs native review. **B** reused from existing LARIS strings (already reviewed upstream).

## Appearance (Settings, `web/src/App.tsx`)

| Key | English | Malay | Chinese | Tamil | Status |
|---|---|---|---|---|---|
| system | Match my device | Ikut peranti saya | 跟随设备 | என் சாதனத்தைப் பின்பற்று | B. Upstream added this same label independently; after the merge the app uses upstream's wording and my "System" draft was dropped |
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

## Tutorial button switch (Settings, Help; `web/src/App.tsx`)

| Key | English | Malay | Chinese | Tamil | Status |
|---|---|---|---|---|---|
| help | Help | Bantuan | 帮助 | உதவி | A |
| showTutorial | Show the Tutorial button | Tunjukkan butang Tutorial | 显示“教程”按钮 | “பயிற்சி” பொத்தானைக் காட்டு | A. Reuses the app's existing word for the button (`guide.button`: Tutorial / 教程 / பயிற்சி) |
| showTutorialHint | The Tutorial button beside page titles, and the ? beside each menu item. Turn it off if you do not need it; turn it on again here any time. | Butang Tutorial di sebelah tajuk halaman, dan tanda ? di sebelah setiap item menu. Matikan jika anda tidak memerlukannya; hidupkan semula di sini pada bila-bila masa. | 页面标题旁的“教程”按钮，以及每个菜单项旁的“?”。不需要时可以关闭，随时可在此重新开启。 | (see file) | A |

## Revenue page (`web/src/Revenue.tsx`, menu entry, permission labels)

All of it is **A: drafted by the assistant, needs a native reader.** About 90 strings in all four languages; the file is the source. The terms that matter most and are easiest to get subtly wrong:

| Concept | English | Malay | Chinese | Tamil |
|---|---|---|---|---|
| Menu and page | Revenue | Hasil | 收入 | வருவாய் |
| Gross profit | Gross profit (untung kasar) | Untung kasar | 毛利 | மொத்த லாபம் |
| Net profit | Net profit (untung bersih) | Untung bersih | 净利润 | நிகர லாபம் |
| Cost of goods | Cost of goods | Kos barang | 商品成本 | பொருள் செலவு |
| Running costs | Running costs | Kos operasi | 经营开支 | இயக்கச் செலவுகள் |
| Money in / out | Money in / Money out | Wang masuk / Wang keluar | 收到的钱 / 支出的钱 | வரும் பணம் / போகும் பணம் |
| A loss | making a loss (rugi) | rugi | 亏损 | நஷ்டம் (rugi) |

Points to check:
- **"Hasil" for Revenue.** In Malay accounting "hasil" means revenue or income, but an SME owner may say "jualan" or "pendapatan". If the owner prefers another word, change `nav.revenue` in `strings.ts` and `S.title` in `Revenue.tsx`.
- **"Kos operasi" for running costs.** Some Malaysian SMEs say "perbelanjaan" or "overhead". "Kos operasi" is the textbook term; confirm it reads naturally.
- **The Malay terms inside other languages.** `untung kasar` and `untung bersih` are written in brackets after the Chinese and Tamil names, because the owner asked for those words. Confirm a Chinese or Tamil reader finds that helpful and not clutter.
- **"sen" in "Every RM1 you sold ... 50 sen".** Chinese uses 仙 (the common Malaysian form of cents) and Tamil சென்; please confirm.
- **Sentences built from numbers** (the headline, the "N more than the period before" lines) have different word order per language; check each reads naturally with a real figure in it.
- **Chart text and table headers** are short, but Tamil is the longest; layout was seen in Tamil at desktop width only.

## Credit notes, goods received, folding menu
All **A: drafted by the assistant, needs a native reader.** Terms to check: "Credit note" (Malay *Nota kredit*, Chinese 贷项通知单, Tamil கிரெடிட் நோட்; some Malaysian businesses say 退款单 or just "credit note"), "Goods received" (Malay *Barang diterima*, Chinese 收货, Tamil பெற்ற பொருட்கள்), the sentence that LARIS does not refund money, and "Fold / Show {group}" on the menu group buttons. The PDF title strings are in `src/doc_layout.py`.

- `web/src/Order.tsx` `pctNone` (ms, zh, ta): the proforma deposit hint now says 50% is suggested when the quote has no deposit percentage. Machine translation, unreviewed.

## Customers and document templates (machine draft, unreviewed)
Customers.tsx (step names, hints, template line, buttons), Templates.tsx (page text, how it works), Deals.tsx (Supplier orders), nav.customers / nav.buying / nav.templates and their menu hints. Terms to check: "Pesanan penghantaran" for delivery order, "Invois proforma", "Templat dokumen", and the Tamil step names.
