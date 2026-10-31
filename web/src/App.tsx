import { DealsView } from './Deals'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { api, resolveMe, getRole, setRole, MOCK, authConfig, getToken, getAccount, can, canOpen, ApiError } from './api'
import type { License } from './api'
import Login from './Login'
import Landing from './Landing'
import { Register, Forgot } from './Signup'
import AcceptInvite from './Invite'
import Accept from './Accept'
import DeliverySign from './DeliverySign'
import { LicenseProvider, LicenceGate, LicenceBanner, LicenceView, PurchaseView, Frame, blocked, setLicenceOn } from './Licence'
import { Shell } from './Shell'
import { ErrorBoundary } from './ErrorBoundary'
import { ToastProvider, useToast } from './Toast'
import IdleGuard from './Idle'
import { AccountView, TeamView } from './Team'
import { RolesView } from './Roles'
import { IssuerView } from './Issuer'
import { ChannelsCard } from './Channels'
import { QuoteSettingsCard } from './QuoteSettings'
import { ContactDetail, ContactsView } from './Contacts'
import { ContractDetail, ContractsView, ProductView, ProductsView, SupplierDetail, SuppliersView } from './Suppliers'
import { SearchView } from './Search'
import { AssistantView, AssistantWidget } from './Assistant'
import { GuidePanel } from './Guide'
import { HomeView } from './Home'
import { RevenueView } from './Revenue'
import { TrackView } from './Track'
import { JobsView } from './JobsBoard'
import { AskView } from './Ask'
import { StatusView, HealthBanner } from './Status'
import { CatalogView } from './Listings'
import { LANGS, setLang, useLang, t } from './i18n'
import type { Text } from './i18n'
import { tx, txOr } from './strings'
import { setShowTutorialButton, useShowTutorialButton } from './helpPrefs'
import { liteVisuals, reduceTransparency, setLiteVisuals, setReduceTransparency, setThemePref, themePref } from './skin'
import type { ThemePref } from './skin'
const txOrReason = (r: string) => txOr(`why.${r}`, r)
import { ActivityView } from './Activity'
import { HelpView } from './Help'
import { PrivacyView } from './Privacy'
import { ApiAccessView } from './ApiAccess'
import { AiSettingsView } from './AiSettings'
import { TourHost } from './Tour'
import { TrackerView } from './TrackerPage'
import { DetailView } from './DocDetail'
import { FilterBar, Tabs, ToggleChip } from './kit'
import { rm, msg, focusTop, useFetch, Async, Skeleton, EmptyState, PageHeader, Hint, OrgCtx, Status, applyBrand, OfflineBanner, HEAT_BANDS, HeatChip, HeatLegend, heatName } from './ui'
import type { Heat } from './ui'
import type { Role, Me, Alert, Followup, MarginReport, Settings, Proposal } from './api'

const S = {
  last7: { en: 'Last 7 days', ms: '7 hari lepas', zh: '最近 7 天', ta: 'கடந்த 7 நாட்கள்' },
  noQuotes7: { en: 'No quotes were created in the last 7 days.', ms: 'Tiada sebut harga dibuat dalam 7 hari lepas.', zh: '最近 7 天没有创建报价。', ta: 'கடந்த 7 நாட்களில் எந்த மேற்கோளும் உருவாக்கப்படவில்லை.' },
  quotes: { en: 'Quotes', ms: 'Sebut harga', zh: '报价', ta: 'மேற்கோள்கள்' },
  quoted: { en: 'Quoted', ms: 'Disebut harga', zh: '报价金额', ta: 'மேற்கோள் தொகை' },
  margin: { en: 'Margin', ms: 'Margin', zh: '利润率', ta: 'மார்ஜின்' },
  wonLost: { en: 'Won / lost', ms: 'Menang / kalah', zh: '成交 / 失败', ta: 'வென்றது / இழந்தது' },
  thinnest: { en: 'Thinnest margin:', ms: 'Margin paling nipis:', zh: '利润率最低：', ta: 'மிகக் குறைந்த மார்ஜின்:' },
  na: { en: 'n/a', ms: 'tiada', zh: '无', ta: 'இல்லை' },
  language: { en: 'Language', ms: 'Bahasa', zh: '语言', ta: 'மொழி' },
  langNote: { en: 'Applies to menus and the main work screens on this device. Each person picks their own.', ms: 'Terpakai pada menu dan skrin kerja utama pada peranti ini. Setiap orang memilih bahasa sendiri.', zh: '适用于此设备上的菜单和主要工作页面。每个人各自选择。', ta: 'இந்தச் சாதனத்தில் மெனுக்களுக்கும் முக்கிய வேலைத் திரைகளுக்கும் பொருந்தும். ஒவ்வொருவரும் தங்களுக்கானதைத் தேர்ந்தெடுக்கிறார்கள்.' },
  appearance: { en: 'Appearance', ms: 'Penampilan', zh: '外观', ta: 'தோற்றம்' },
  theme: { en: 'Theme', ms: 'Tema', zh: '主题', ta: 'தீம்' },
  light: { en: 'Light', ms: 'Cerah', zh: '浅色', ta: 'ஒளி' },
  system: { en: 'Match my device', ms: 'Ikut peranti saya', zh: '跟随设备', ta: 'என் சாதனத்தைப் பின்பற்று' },
  dark: { en: 'Dark', ms: 'Gelap', zh: '深色', ta: 'இருண்டது' },
  reduceTransparency: { en: 'Reduce transparency', ms: 'Kurangkan kelutsinaran', zh: '减少透明效果', ta: 'ஒளிஊடுருவலைக் குறைக்கவும்' },
  reduceTransparencyHint: { en: 'Solid panels instead of frosted glass. Also on when your device asks for less transparency.', ms: 'Panel pepejal, bukan kaca berfros. Turut aktif jika peranti anda meminta kurang kelutsinaran.', zh: '用实色面板代替磨砂玻璃。当设备要求减少透明效果时也会自动启用。', ta: 'பனிக்கண்ணாடிக்குப் பதிலாக திடமான பலகைகள். உங்கள் சாதனம் குறைந்த ஒளிஊடுருவலைக் கேட்டாலும் இது இயங்கும்.' },
  help: { en: 'Help', ms: 'Bantuan', zh: '帮助', ta: 'உதவி' },
  showTutorial: { en: 'Show the Tutorial button', ms: 'Tunjukkan butang Tutorial', zh: '显示“教程”按钮', ta: '“பயிற்சி” பொத்தானைக் காட்டு' },
  showTutorialHint: { en: 'The Tutorial button beside page titles, and the ? beside each menu item. Turn it off if you do not need it; turn it on again here any time.', ms: 'Butang Tutorial di sebelah tajuk halaman, dan tanda ? di sebelah setiap item menu. Matikan jika anda tidak memerlukannya; hidupkan semula di sini pada bila-bila masa.', zh: '页面标题旁的“教程”按钮，以及每个菜单项旁的“?”。不需要时可以关闭，随时可在此重新开启。', ta: 'பக்கத் தலைப்புகளின் அருகிலுள்ள “பயிற்சி” பொத்தானும், ஒவ்வொரு மெனு உருப்படியின் அருகிலுள்ள “?” குறியும். தேவையில்லையெனில் அணைக்கவும்; எப்போது வேண்டுமானாலும் இங்கே மீண்டும் இயக்கலாம்.' },
  liteVisuals: { en: 'Lite visuals', ms: 'Visual ringan', zh: '精简视觉效果', ta: 'எளிய காட்சிகள்' },
  liteVisualsHint: { en: 'Stops the moving background and softens the blur. Helps on older phones.', ms: 'Hentikan latar bergerak dan kurangkan kabur. Membantu pada telefon lama.', zh: '停止动态背景并减弱模糊效果，适合较旧的手机。', ta: 'நகரும் பின்னணியை நிறுத்தி மங்கலைக் குறைக்கும். பழைய தொலைபேசிகளுக்கு உதவும்.' },
  remembered: { en: 'Remembered on this device.', ms: 'Diingati pada peranti ini.', zh: '会记住在此设备上。', ta: 'இந்தச் சாதனத்தில் நினைவில் வைக்கப்படும்.' },
  settings: { en: 'Settings', ms: 'Tetapan', zh: '设置', ta: 'அமைப்புகள்' },
  noAccess: { en: 'You do not have access. Only the owner changes settings.', ms: 'Anda tiada akses. Hanya pemilik boleh menukar tetapan.', zh: '您没有权限。只有老板可以更改设置。', ta: 'உங்களுக்கு அணுகல் இல்லை. உரிமையாளர் மட்டுமே அமைப்புகளை மாற்ற முடியும்.' },
  ssm: { en: 'SSM registration number', ms: 'Nombor pendaftaran SSM', zh: 'SSM 注册号', ta: 'SSM பதிவு எண்' },
  address: { en: 'Business address', ms: 'Alamat perniagaan', zh: '企业地址', ta: 'வணிக முகவரி' },
  bank: { en: 'Bank details for payment', ms: 'Butiran bank untuk pembayaran', zh: '付款银行资料', ta: 'பணம் செலுத்துவதற்கான வங்கி விவரங்கள்' },
  sstNo: { en: 'SST registration number', ms: 'Nombor pendaftaran SST', zh: 'SST 注册号', ta: 'SST பதிவு எண்' },
  logoType: { en: 'Use a PNG, JPEG or WebP image. SVG is not accepted.', ms: 'Gunakan imej PNG, JPEG atau WebP. SVG tidak diterima.', zh: '请使用 PNG、JPEG 或 WebP 图片。不接受 SVG。', ta: 'PNG, JPEG அல்லது WebP படத்தைப் பயன்படுத்தவும். SVG ஏற்கப்படாது.' },
  logoBig: { en: 'That image is over 10 MB. Use a smaller one.', ms: 'Imej itu melebihi 10 MB. Gunakan yang lebih kecil.', zh: '该图片超过 10 MB。请使用较小的图片。', ta: 'அந்தப் படம் 10 MB ஐ விட அதிகம். சிறியதைப் பயன்படுத்தவும்.' },
  logoRead: { en: 'Could not read that image, or it is still too large after shrinking. Try another image.', ms: 'Imej itu tidak dapat dibaca, atau masih terlalu besar selepas dikecilkan. Cuba imej lain.', zh: '无法读取该图片，或缩小后仍然太大。请换一张图片。', ta: 'அந்தப் படத்தைப் படிக்க முடியவில்லை, அல்லது சுருக்கிய பின்னும் மிகப் பெரியதாக உள்ளது. வேறு படத்தை முயற்சிக்கவும்.' },
  colourBad: { en: 'The brand colour must be a hex colour like #0f5c47.', ms: 'Warna jenama mesti warna hex seperti #0f5c47.', zh: '品牌颜色必须是十六进制颜色，例如 #0f5c47。', ta: 'பிராண்ட் நிறம் #0f5c47 போன்ற ஹெக்ஸ் நிறமாக இருக்க வேண்டும்.' },
  saved: { en: 'Settings saved.', ms: 'Tetapan disimpan.', zh: '设置已保存。', ta: 'அமைப்புகள் சேமிக்கப்பட்டன.' },
  logo413: { en: 'The logo is still too large after shrinking. Try a simpler image.', ms: 'Logo masih terlalu besar selepas dikecilkan. Cuba imej yang lebih ringkas.', zh: '标志缩小后仍然太大。请换一张更简单的图片。', ta: 'லோகோ சுருக்கிய பின்னும் மிகப் பெரியதாக உள்ளது. எளிய படத்தை முயற்சிக்கவும்.' },
  logo415: { en: 'The logo must be a PNG, JPEG or WebP image.', ms: 'Logo mesti imej PNG, JPEG atau WebP.', zh: '标志必须是 PNG、JPEG 或 WebP 图片。', ta: 'லோகோ PNG, JPEG அல்லது WebP படமாக இருக்க வேண்டும்.' },
  colour422: { en: 'The brand colour is not valid. Use a hex colour like #0f5c47.', ms: 'Warna jenama tidak sah. Gunakan warna hex seperti #0f5c47.', zh: '品牌颜色无效。请使用十六进制颜色，例如 #0f5c47。', ta: 'பிராண்ட் நிறம் செல்லாது. #0f5c47 போன்ற ஹெக்ஸ் நிறத்தைப் பயன்படுத்தவும்.' },
  settingsLead: { en: 'The margin floor flags thin quotes for review. The business details are printed on the quote PDF. Branding shows in the header for everyone after you save.', ms: 'Lantai margin menandakan sebut harga nipis untuk disemak. Butiran perniagaan dicetak pada PDF sebut harga. Penjenamaan dipaparkan di pengepala untuk semua orang selepas anda simpan.', zh: '最低利润率会标出利润偏低的报价供审核。企业资料会印在报价 PDF 上。保存后，品牌设置会显示在所有人的页眉中。', ta: 'குறைந்தபட்ச மார்ஜின் குறைவான மேற்கோள்களை மதிப்பாய்வுக்காகக் குறிக்கிறது. வணிக விவரங்கள் மேற்கோள் PDF இல் அச்சிடப்படும். சேமித்த பிறகு பிராண்டிங் அனைவருக்கும் தலைப்பில் தெரியும்.' },
  tabsLabel: { en: 'Settings sections', ms: 'Bahagian tetapan', zh: '设置分区', ta: 'அமைப்புப் பிரிவுகள்' },
  tGeneral: { en: 'General', ms: 'Umum', zh: '常规', ta: 'பொது' },
  tBusiness: { en: 'Business', ms: 'Perniagaan', zh: '企业', ta: 'வணிகம்' },
  tQuotes: { en: 'Quotes', ms: 'Sebut harga', zh: '报价', ta: 'மேற்கோள்கள்' },
  tChannels: { en: 'Channels', ms: 'Saluran', zh: '渠道', ta: 'சேனல்கள்' },
  branding: { en: 'Branding (everyone sees this)', ms: 'Penjenamaan (dilihat semua orang)', zh: '品牌（所有人可见）', ta: 'பிராண்டிங் (அனைவருக்கும் தெரியும்)' },
  orgName: { en: 'Organisation display name', ms: 'Nama paparan organisasi', zh: '组织显示名称', ta: 'நிறுவனக் காட்சிப் பெயர்' },
  brandHex: { en: 'Brand colour (hex)', ms: 'Warna jenama (hex)', zh: '品牌颜色（十六进制）', ta: 'பிராண்ட் நிறம் (ஹெக்ஸ்)' },
  pickColour: { en: 'Pick a colour', ms: 'Pilih warna', zh: '选择颜色', ta: 'நிறத்தைத் தேர்ந்தெடு' },
  resetColour: { en: 'Reset colour', ms: 'Tetap semula warna', zh: '重置颜色', ta: 'நிறத்தை மீட்டமை' },
  colourNotValid: { en: 'Not a valid colour yet. Use # and six hex digits.', ms: 'Belum warna yang sah. Gunakan # dan enam digit hex.', zh: '还不是有效的颜色。请使用 # 加六位十六进制数字。', ta: 'இன்னும் செல்லுபடியாகும் நிறம் அல்ல. # மற்றும் ஆறு ஹெக்ஸ் இலக்கங்களைப் பயன்படுத்தவும்.' },
  colourNone: { en: 'No colour set: the standard LARIS green is used.', ms: 'Tiada warna ditetapkan: hijau LARIS standard digunakan.', zh: '未设置颜色：使用标准的 LARIS 绿色。', ta: 'நிறம் அமைக்கப்படவில்லை: நிலையான LARIS பச்சை பயன்படுத்தப்படும்.' },
  logoLabel: { en: 'Logo (PNG, JPEG or WebP, up to 10 MB; shrunk for you)', ms: 'Logo (PNG, JPEG atau WebP, sehingga 10 MB; dikecilkan untuk anda)', zh: '标志（PNG、JPEG 或 WebP，最大 10 MB；会自动缩小）', ta: 'லோகோ (PNG, JPEG அல்லது WebP, 10 MB வரை; உங்களுக்காகச் சுருக்கப்படும்)' },
  logoPreview: { en: 'Logo preview', ms: 'Pratonton logo', zh: '标志预览', ta: 'லோகோ முன்னோட்டம்' },
  removeLogo: { en: 'Remove logo', ms: 'Buang logo', zh: '移除标志', ta: 'லோகோவை நீக்கு' },
  noLogo: { en: 'No logo: initials are shown instead.', ms: 'Tiada logo: huruf awal dipaparkan.', zh: '没有标志：改为显示首字母。', ta: 'லோகோ இல்லை: அதற்குப் பதிலாக முதலெழுத்துகள் காட்டப்படும்.' },
  floor: { en: 'Margin floor (%)', ms: 'Lantai margin (%)', zh: '最低利润率 (%)', ta: 'குறைந்தபட்ச மார்ஜின் (%)' },
  floorHint: { en: 'Margin is profit as a share of the selling price. A quote below this is flagged for review.', ms: 'Margin ialah keuntungan sebagai bahagian daripada harga jualan. Sebut harga di bawah ini ditandakan untuk semakan.', zh: '利润率是利润占售价的比例。低于此值的报价会被标记待审核。', ta: 'மார்ஜின் என்பது விற்பனை விலையில் லாபத்தின் பங்கு. இதற்குக் கீழ் உள்ள மேற்கோள் மதிப்பாய்வுக்காகக் குறிக்கப்படும்.' },
  sstReg: { en: 'Registered for SST', ms: 'Berdaftar untuk SST', zh: '已注册 SST', ta: 'SST க்கு பதிவு செய்யப்பட்டது' },
  saving: { en: 'Saving...', ms: 'Menyimpan...', zh: '正在保存...', ta: 'சேமிக்கிறது...' },
  save: { en: 'Save settings', ms: 'Simpan tetapan', zh: '保存设置', ta: 'அமைப்புகளைச் சேமி' },
  fldAdding: { en: 'Adding...', ms: 'Menambah...', zh: '正在添加...', ta: 'சேர்க்கிறது...' },
  fldIgnoring: { en: 'Ignoring...', ms: 'Mengabaikan...', zh: '正在忽略...', ta: 'புறக்கணிக்கிறது...' },
  newFields: { en: 'New fields seen on documents', ms: 'Medan baharu dilihat pada dokumen', zh: '文档中发现的新字段', ta: 'ஆவணங்களில் காணப்பட்ட புதிய புலங்கள்' },
  newFieldsLead: { en: 'A field the extractor found that is not a column yet. Nothing becomes a column until you approve it.', ms: 'Medan yang ditemui oleh pengekstrak tetapi belum menjadi lajur. Tiada apa menjadi lajur sehingga anda meluluskannya.', zh: '提取器发现了一个还不是列的字段。在您批准之前，不会变成列。', ta: 'பிரித்தெடுப்பி கண்ட, இன்னும் நெடுவரிசையாக இல்லாத புலம். நீங்கள் அங்கீகரிக்கும் வரை எதுவும் நெடுவரிசையாக மாறாது.' },
  noFields: { en: 'No unknown fields waiting for a decision.', ms: 'Tiada medan tidak dikenali yang menunggu keputusan.', zh: '没有等待决定的未知字段。', ta: 'முடிவுக்காகக் காத்திருக்கும் தெரியாத புலங்கள் எதுவும் இல்லை.' },
  sample: { en: 'Sample values:', ms: 'Nilai contoh:', zh: '示例值：', ta: 'மாதிரி மதிப்புகள்:' },
  colType: { en: 'Column type', ms: 'Jenis lajur', zh: '列类型', ta: 'நெடுவரிசை வகை' },
  alertsTitle: { en: 'Stale-cost alerts', ms: 'Amaran kos lapuk', zh: '过时成本提醒', ta: 'பழைய செலவு எச்சரிக்கைகள்' },
  alertsLead: { en: 'Quotes still open whose supplier cost has risen since pricing. Nothing is re-priced automatically.', ms: 'Sebut harga yang masih terbuka dan kos pembekalnya telah naik sejak penetapan harga. Tiada apa dihargakan semula secara automatik.', zh: '仍未结的报价，其供应商成本在定价后已上涨。不会自动重新定价。', ta: 'விலை நிர்ணயித்த பிறகு சப்ளையர் செலவு உயர்ந்த, இன்னும் திறந்துள்ள மேற்கோள்கள். எதுவும் தானாக மறுவிலை நிர்ணயிக்கப்படாது.' },
  alertsNone: { en: 'No open quote is affected by a newer supplier cost.', ms: 'Tiada sebut harga terbuka yang terjejas oleh kos pembekal yang lebih baharu.', zh: '没有未结报价受到更新的供应商成本影响。', ta: 'புதிய சப்ளையர் செலவால் பாதிக்கப்பட்ட திறந்த மேற்கோள் எதுவும் இல்லை.' },
  alertsHint: { en: 'You will see a quote here if a supplier raises a price after you quoted.', ms: 'Anda akan nampak sebut harga di sini jika pembekal menaikkan harga selepas anda memberi sebut harga.', zh: '如果供应商在您报价后涨价，该报价会显示在这里。', ta: 'நீங்கள் மேற்கோள் தந்த பிறகு சப்ளையர் விலையை உயர்த்தினால், அந்த மேற்கோள் இங்கே தெரியும்.' },
  notFound: { en: 'Page not found', ms: 'Halaman tidak ditemui', zh: '找不到页面', ta: 'பக்கம் கிடைக்கவில்லை' },
  notExist: { en: 'That page does not exist.', ms: 'Halaman itu tidak wujud.', zh: '该页面不存在。', ta: 'அந்தப் பக்கம் இல்லை.' },
  openTracker: { en: 'Open the tracker', ms: 'Buka penjejak', zh: '打开报价追踪', ta: 'கண்காணிப்பைத் திற' },
  page: { en: 'Page', ms: 'Halaman', zh: '页面', ta: 'பக்கம்' },
  denied: { en: 'You do not have access to this page. Ask the owner to change your role if you need it.', ms: 'Anda tiada akses ke halaman ini. Minta pemilik menukar peranan anda jika anda memerlukannya.', zh: '您没有权限访问此页面。如有需要，请让老板更改您的角色。', ta: 'இந்தப் பக்கத்திற்கு உங்களுக்கு அணுகல் இல்லை. தேவைப்பட்டால் உங்கள் பங்கை மாற்றுமாறு உரிமையாளரிடம் கேளுங்கள்.' },
  lic402: { en: 'Your licence is missing or expired, so that change was not saved.', ms: 'Lesen anda tiada atau telah tamat tempoh, jadi perubahan itu tidak disimpan.', zh: '您的许可证缺失或已过期，因此该更改未保存。', ta: 'உங்கள் உரிமம் இல்லை அல்லது காலாவதியாகிவிட்டது, எனவே அந்த மாற்றம் சேமிக்கப்படவில்லை.' },
  openLic: { en: 'Open licence', ms: 'Buka lesen', zh: '打开许可证', ta: 'உரிமத்தைத் திற' },
  noMe: { en: 'Could not identify the signed-in user:', ms: 'Tidak dapat mengenal pasti pengguna yang log masuk:', zh: '无法识别已登录的用户：', ta: 'உள்நுழைந்த பயனரை அடையாளம் காண முடியவில்லை:' },
  retryMe: { en: 'Retry identifying user', ms: 'Cuba kenal pasti pengguna semula', zh: '重试识别用户', ta: 'பயனரை அடையாளம் காண மீண்டும் முயற்சி' },
  owner: { en: 'Owner', ms: 'Pemilik', zh: '老板', ta: 'உரிமையாளர்' },
  staff: { en: 'Staff', ms: 'Staf', zh: '员工', ta: 'ஊழியர்' },
} satisfies Record<string, Text>
const COL_TYPES = { text: { en: 'text', ms: 'teks', zh: '文本', ta: 'உரை' }, number: { en: 'number', ms: 'nombor', zh: '数字', ta: 'எண்' }, integer: { en: 'integer', ms: 'integer', zh: '整数', ta: 'முழு எண்' },
  date: { en: 'date', ms: 'tarikh', zh: '日期', ta: 'தேதி' }, select: { en: 'select', ms: 'pilihan', zh: '选项', ta: 'தேர்வு' }, boolean: { en: 'boolean', ms: 'boolean', zh: '是/否', ta: 'ஆம்/இல்லை' } } satisfies Record<string, Text>

// ---------- Stale-cost alerts + field proposals ----------
function Report() {
  useLang()
  const s = useFetch<MarginReport>('/reports/margin?days=7')
  const r = s.data
  return (
    <section className="mb-8" aria-labelledby="wk">
      <h2 id="wk" className="mb-2 text-base font-semibold">{t(S.last7)}</h2>
      <Async s={s} empty={!r || !r.quotes} emptyText={t(S.noQuotes7)}>
        {r && <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([[S.quotes, String(r.quotes ?? 0)], [S.quoted, rm(r.revenue)], [S.margin, `${rm(r.margin)}${r.margin_pct != null ? ` (${r.margin_pct}%)` : ''}`],
               [S.wonLost, `${r.won ?? 0} / ${r.lost ?? 0}`]] as const).map(([k, v]) => (
              <div key={k.en} className="card"><dt className="text-sm text-muted">{t(k)}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          {(r.lowest_margin?.length ?? 0) > 0 && <p className="mt-2 text-sm">{t(S.thinnest)} {r.lowest_margin!.map((q, i) => (
            <span key={q.quote_id}>{i > 0 && ', '}<a className="link" href={`#/doc/${q.quote_id}`}>{q.quote_no}</a> ({q.margin_pct ?? t(S.na)}%)</span>))}</p>}
        </>}
      </Async>
    </section>
  )
}



const SETTINGS_TABS = ['general', 'business', 'quotes', 'channels'] as const
type SettingsTab = typeof SETTINGS_TABS[number]
// #/settings/<tab> opens that tab (the search palette links there); read from the live hash so a language change, which remounts the page, keeps the tab.
const tabFromHash = (): SettingsTab => SETTINGS_TABS.find(t => location.hash.split('?')[0].split('/')[2] === t) ?? 'general'

function GeneralTab({ setDark }: { setDark: (d: boolean) => void }) {
  const [lang] = useLang()
  const [pref, setPref] = useState<ThemePref>(themePref)
  const [calm, setCalm] = useState(reduceTransparency)
  const [lite, setLite] = useState(liteVisuals)
  const showTut = useShowTutorialButton()
  return (
    <div className="grid max-w-xl gap-4">
      <fieldset className="grid gap-2 rounded-ui border border-soft p-3" data-guide="st-general">
        <legend className="px-1 text-sm font-semibold">{t(S.language)}</legend>
        <div role="group" aria-label={t(S.language)} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LANGS.map(([l, n]) => <button key={l} type="button" lang={l} className="btn aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={lang === l} onClick={() => setLang(l)}>{n}</button>)}
        </div>
        <p className="text-sm text-muted">{t(S.langNote)}</p>
      </fieldset>
      <fieldset className="grid gap-2 rounded-ui border border-soft p-3">
        <legend className="px-1 text-sm font-semibold">{t(S.appearance)}</legend>
        <div role="group" aria-label={t(S.theme)} className="grid grid-cols-3 gap-2 sm:max-w-sm">
          {([[S.light, 'light'], [S.dark, 'dark'], [S.system, 'system']] as const).map(([n, p]) => <button key={p} type="button" className="btn aria-pressed:bg-tint aria-pressed:font-bold" aria-pressed={pref === p}
            onClick={() => { setPref(p); setDark(setThemePref(p)) }}>{t(n)}</button>)}
        </div>
        <label className="mt-1 flex items-start gap-3 py-1 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-(--accent)" checked={calm} onChange={e => { setCalm(e.target.checked); setReduceTransparency(e.target.checked) }} />
          <span><span className="block font-semibold">{t(S.reduceTransparency)}</span><span className="block text-muted">{t(S.reduceTransparencyHint)}</span></span>
        </label>
        <label className="flex items-start gap-3 py-1 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-(--accent)" checked={lite} onChange={e => { setLite(e.target.checked); setLiteVisuals(e.target.checked) }} />
          <span><span className="block font-semibold">{t(S.liteVisuals)}</span><span className="block text-muted">{t(S.liteVisualsHint)}</span></span>
        </label>
        <p className="text-sm text-muted">{t(S.remembered)}</p>
      </fieldset>
      <fieldset className="grid gap-2 rounded-ui border border-soft p-3">
        <legend className="px-1 text-sm font-semibold">{t(S.help)}</legend>
        <label className="flex items-start gap-3 py-1 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-(--accent)" checked={showTut} onChange={e => setShowTutorialButton(e.target.checked)} />
          <span><span className="block font-semibold">{t(S.showTutorial)}</span><span className="block text-muted">{t(S.showTutorialHint)}</span></span>
        </label>
        <p className="text-sm text-muted">{t(S.remembered)}</p>
      </fieldset>
    </div>
  )
}

function SettingsView({ owner, setDark }: { owner: boolean; setDark: (d: boolean) => void }) {
  useLang()
  const s = useFetch<Settings>('/settings')
  const [f, setF] = useState<Settings>()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoErr, setLogoErr] = useState('')
  const [tab, setTab] = useState<SettingsTab>(tabFromHash)
  const toast = useToast()
  useEffect(() => { if (s.data) setF(s.data) }, [s.data])
  if (!owner) return <><PageHeader title={t(S.settings)} /><p className="card text-muted">{t(S.noAccess)}</p></>
  const text = (k: 'ssm_no' | 'address' | 'bank_details' | 'sst_no', name: string) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">{name}
      <input className="input font-normal" value={f?.[k] ?? ''} onChange={e => f && setF({ ...f, [k]: e.target.value })} /></label>
  )
  const colour = (f?.brand_color ?? '').trim()
  const colourOk = colour === '' || /^#[0-9a-f]{6}$/i.test(colour)
  // Logo: png, jpeg or webp up to 10 MB. The browser shrinks it (longest side 512 px, then lower quality if needed) so what is
  // stored stays under the server's 200 KB limit. The server checks the real bytes again.
  const pickLogo = async (file?: File) => {
    setLogoErr('')
    if (!file || !f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoErr(t(S.logoType))
    if (file.size > 10 * 1024 * 1024) return setLogoErr(t(S.logoBig))
    try { const url = await shrinkLogo(file); setF(p => p && { ...p, logo_data_url: url }) }
    catch { setLogoErr(t(S.logoRead)) }
  }
  const save = async () => {
    if (!f || busy) return
    setErr('')
    if (!colourOk) return setErr(t(S.colourBad))
    setBusy(true)
    try {
      const out = await api<Settings>('POST', '/settings', {
        display_name: f.display_name?.trim() || null, brand_color: colour ? colour.toLowerCase() : null, logo_data_url: f.logo_data_url || null,
        min_margin_pct: f.min_margin_pct, ssm_no: f.ssm_no ?? '', address: f.address ?? '', bank_details: f.bank_details ?? '',
        sst_registered: f.sst_registered, sst_no: f.sst_no ?? '' })
      setF(out); toast(t(S.saved))
      window.dispatchEvent(new Event('laris:branding'))
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 413 ? t(S.logo413)
        : e instanceof ApiError && e.status === 415 ? t(S.logo415)
        : e instanceof ApiError && e.status === 422 && /colou?r/i.test(e.code + e.message) ? t(S.colour422) : msg(e))
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title={t(S.settings)} description={t(S.settingsLead)} />
      <div data-guide="st-tabs"><Tabs label={t(S.tabsLabel)} value={tab} onChange={v => { setTab(v as SettingsTab); history.replaceState(null, '', `#/settings/${v}`) }}
        options={[{ value: 'general', label: t(S.tGeneral) }, { value: 'business', label: t(S.tBusiness) }, { value: 'quotes', label: t(S.tQuotes) }, { value: 'channels', label: t(S.tChannels) }]} /></div>
      {tab === 'general' && <GeneralTab setDark={setDark} />}
      {(tab === 'business' || tab === 'quotes') && <Async s={s} empty={false} rows={4}>
        {f && (
          <form className="grid max-w-xl gap-3" onSubmit={e => { e.preventDefault(); save() }}>
            {tab === 'business' && <fieldset className="grid gap-3 rounded-ui border border-soft p-3" data-guide="st-business">
              <legend className="px-1 text-sm font-semibold">{t(S.branding)}</legend>
              <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.orgName)}
                <input className="input font-normal" maxLength={120} value={f.display_name ?? ''} onChange={e => setF({ ...f, display_name: e.target.value })} /></label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.brandHex)}
                  <input className="input w-32 font-normal" placeholder="#0f5c47" maxLength={7} autoCapitalize="none" spellCheck={false} aria-invalid={!colourOk || undefined} aria-describedby="bc-help"
                    value={f.brand_color ?? ''} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.pickColour)}
                  <input type="color" className="input w-16 p-1" value={colourOk && colour ? colour.toLowerCase() : '#0f5c47'} onChange={e => setF({ ...f, brand_color: e.target.value })} /></label>
                <span aria-hidden="true" className="size-11 rounded-ui border border-line" style={{ backgroundColor: colourOk && colour ? colour : 'var(--accent)' }} />
                <button type="button" className="btn" onClick={() => setF({ ...f, brand_color: null })}>{t(S.resetColour)}</button>
              </div>
              <p id="bc-help" className="text-sm text-muted">{colour ? (colourOk ? t({ en: `Colour ${colour.toLowerCase()} is used for main buttons and the active tab.`, ms: `Warna ${colour.toLowerCase()} digunakan untuk butang utama dan tab aktif.`, zh: `颜色 ${colour.toLowerCase()} 用于主要按钮和当前标签页。`, ta: `நிறம் ${colour.toLowerCase()} முக்கியப் பொத்தான்களுக்கும் செயலில் உள்ள தாவலுக்கும் பயன்படுத்தப்படுகிறது.` }) : t(S.colourNotValid)) : t(S.colourNone)}</p>
              <div className="grid gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">{t(S.logoLabel)}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="input py-2 font-normal" aria-describedby={logoErr ? 'logo-err' : undefined}
                    onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = '' }} /></label>
                {logoErr && <p id="logo-err" role="alert" className="text-sm text-warn">{logoErr}</p>}
                {f.logo_data_url
                  ? <div className="flex flex-wrap items-center gap-3"><img src={f.logo_data_url} alt={t(S.logoPreview)} className="h-12 max-w-40 rounded-ui border border-soft bg-surface object-contain p-1" />
                      <button type="button" className="btn" onClick={() => setF({ ...f, logo_data_url: null })}>{t(S.removeLogo)}</button></div>
                  : <p className="text-sm text-muted">{t(S.noLogo)}</p>}
              </div>
            </fieldset>}
            {tab === 'quotes' && <label className="flex flex-col gap-1 text-sm font-semibold" data-guide="st-margin">{t(S.floor)}
              <input className="input font-normal" inputMode="decimal" aria-describedby="mf-help" value={f.min_margin_pct} onChange={e => setF({ ...f, min_margin_pct: e.target.value })} />
              <Hint id="mf-help">{t(S.floorHint)}</Hint></label>}
            {tab === 'business' && <>
              {text('ssm_no', t(S.ssm))}
              {text('address', t(S.address))}
              {text('bank_details', t(S.bank))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={f.sst_registered} onChange={e => setF({ ...f, sst_registered: e.target.checked })} /> {t(S.sstReg)}</label>
              {f.sst_registered && text('sst_no', t(S.sstNo))}
            </>}
            {err && <p role="alert" className="text-sm text-warn">{err}</p>}
            <div><button type="submit" className="btn btn-primary" data-guide="st-save" aria-disabled={busy || undefined}>{busy ? t(S.saving) : t(S.save)}</button></div>
          </form>
        )}
      </Async>}
      {tab === 'quotes' && <QuoteSettingsCard />}
      {tab === 'channels' && <ChannelsCard />}
    </>
  )
}

function Followups() {
  const s = useFetch<Followup[]>(can('manage_followups') ? '/followups' : null)  // no permission: no request (the page is not reachable then anyway)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')  // "<id>:<action>" while that call runs
  const [band, setBand] = useState<Heat | ''>('')
  const toast = useToast()
  const act = async (f: Followup, action: 'send' | 'skip') => {
    if (busy) return
    setErr(''); setBusy(`${f.id}:${action}`)
    try { await api('POST', `/followups/${f.id}`, { action }); toast(action === 'send' ? tx('fu.sentToast', f.doc_no) : tx('fu.skippedToast', f.doc_no)); s.reload() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  const counts = Object.fromEntries(HEAT_BANDS.map(h => [h, (s.data ?? []).filter(f => f.heat === h).length])) as Record<Heat, number>
  const shown = (s.data ?? []).filter(f => !band || f.heat === band)
  return (
    <section id="followups" aria-label={tx('fu.aria')}>
      <PageHeader title={tx('fu.title')} description={tx('fu.lead')} />
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      {!!s.data?.length && <>
        <div data-guide="fu-bands"><FilterBar label={tx('fu.filters')} chips={band ? [{ label: tx('fu.ageChip', heatName(band)), onRemove: () => setBand('') }] : []} onClear={band ? () => setBand('') : undefined}>
          {HEAT_BANDS.map(h => <ToggleChip key={h} pressed={band === h} onClick={() => setBand(band === h ? '' : h)}><span aria-hidden="true" className={`heat-${h} size-2.5 rounded-full`} style={{ background: 'var(--heat-fg)' }} />{heatName(h)} <span className="tabular-nums">{counts[h]}</span></ToggleChip>)}
        </FilterBar></div>
        <div className="mb-3" data-guide="fu-legend"><HeatLegend /></div>
      </>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText={tx('fu.none')} emptyHint={tx('fu.noneHint')}>
        {shown.length === 0 ? <p className="card text-sm text-muted">{tx('fu.noneInBand')} <button type="button" className="link" onClick={() => setBand('')}>{tx('fu.showAll')}</button></p> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {shown.map((f, k) => (
            <li key={f.id} data-guide={k === 0 ? 'fu-card' : undefined} className={`card ${f.heat ? `heat-edge heat-${f.heat}` : ''}`}>
              <p className="flex flex-wrap items-center gap-2 font-semibold"><a className="link" href={`#/doc/${f.document_id}`}>{f.doc_no}</a> <span className="font-normal">{tx('fu.for', f.customer)}</span>
                {f.days_waiting != null && <HeatChip heat={f.heat} days={f.days_waiting} />}</p>
              <p className="mt-1 text-sm text-muted">{txOrReason(f.reason)}{f.days_waiting != null ? `, ${tx('fu.sentAgo', f.days_waiting)}` : ''}</p>
              <p className="mt-2 text-sm">{f.suggested_text ?? tx('fu.noContact')}</p>
              {can('manage_followups') && <div className="mt-3 flex flex-wrap gap-2">
                {f.suggested_text && <button type="button" className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => act(f, 'send')}>{busy === `${f.id}:send` ? tx('fu.sending') : tx('fu.send', f.doc_no)}</button>}
                <button type="button" className="btn" aria-disabled={!!busy || undefined} onClick={() => act(f, 'skip')}>{busy === `${f.id}:skip` ? tx('fu.skipping') : tx('fu.skip', f.doc_no)}</button>
              </div>}
            </li>
          ))}
        </ul>)}
      </Async>
    </section>
  )
}

function Proposals() {
  useLang()
  const s = useFetch<Proposal[]>('/field-proposals')
  const [err, setErr] = useState('')
  const [type, setType] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const decide = async (p: Proposal, decision: 'approve' | 'ignore') => {
    if (busy) return
    setErr(''); setBusy(`${p.id}:${decision}`)
    try { await api('POST', `/field-proposals/${p.id}/decide`, { decision, type: type[p.id] ?? 'text', label: p.key.replace(/_/g, ' ') }); toast(decision === 'approve' ? t({ en: `${p.key} added as a column.`, ms: `${p.key} ditambah sebagai lajur.`, zh: `${p.key} 已添加为列。`, ta: `${p.key} நெடுவரிசையாகச் சேர்க்கப்பட்டது.` }) : t({ en: `${p.key} ignored.`, ms: `${p.key} diabaikan.`, zh: `已忽略 ${p.key}。`, ta: `${p.key} புறக்கணிக்கப்பட்டது.` })); s.reload(); focusTop() }
    catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }
  return (
    <section className="mt-10 border-t border-soft pt-6" aria-labelledby="newf">
      <h2 id="newf" className="text-base font-semibold">{t(S.newFields)}</h2>
      <p className="mb-2 text-sm text-muted">{t(S.newFieldsLead)}</p>
      {err && <p role="alert" className="mb-2 text-sm text-warn">{err}</p>}
      <Async s={s} rows={2} empty={!s.data?.length} emptyText={t(S.noFields)}>
        <ul className="grid gap-2 md:grid-cols-2">
          {s.data?.map(p => (
            <li key={p.id} className="card">
              <p className="font-semibold">{p.key}</p>
              <p className="text-sm text-muted">{t(S.sample)} {p.sample_values.map(String).join(', ')}</p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">{t(S.colType)}
                <select className="input" value={type[p.id] ?? 'text'} onChange={e => setType({ ...type, [p.id]: e.target.value })}>
                  {(Object.keys(COL_TYPES) as (keyof typeof COL_TYPES)[]).map(k => <option key={k} value={k}>{t(COL_TYPES[k])}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'approve')}>{busy === `${p.id}:approve` ? t(S.fldAdding) : t({ en: `Add ${p.key} as column`, ms: `Tambah ${p.key} sebagai lajur`, zh: `将 ${p.key} 添加为列`, ta: `${p.key} ஐ நெடுவரிசையாகச் சேர்` })}</button>
                <button className="btn" aria-disabled={!!busy || undefined} onClick={() => decide(p, 'ignore')}>{busy === `${p.id}:ignore` ? t(S.fldIgnoring) : t({ en: `Ignore ${p.key}`, ms: `Abaikan ${p.key}`, zh: `忽略 ${p.key}`, ta: `${p.key} ஐப் புறக்கணி` })}</button>
              </div>
            </li>
          ))}
        </ul>
      </Async>
    </section>
  )
}

function AlertsView() {
  useLang()
  const s = useFetch<Alert[]>('/alerts/stale-costs')
  const n = s.data?.length ?? 0
  const lost = (s.data ?? []).reduce((a, x) => a + (Number(x.margin_delta) || 0), 0)
  return (
    <>
      <PageHeader title={t(S.alertsTitle)} description={t(S.alertsLead)} />
      {can('view_reports') && can('view_costs') && <Report />}
      <p role="status" className={s.data && n ? 'mb-4 border-l-4 border-amber pl-3 text-xl font-semibold' : 'sr-only'}>{s.data && n ? t({ en: `${n} open ${n === 1 ? 'quote' : 'quotes'} affected, margin down ${rm(String(Math.abs(lost)))} in total`, ms: `${n} sebut harga terbuka terjejas, margin turun ${rm(String(Math.abs(lost)))} secara keseluruhan`, zh: `${n} 张未结报价受影响，利润合计减少 ${rm(String(Math.abs(lost)))}`, ta: `${n} திறந்த மேற்கோள்கள் பாதிப்பு, மார்ஜின் மொத்தம் ${rm(String(Math.abs(lost)))} குறைந்தது` }) : ''}</p>
      <Async s={s} empty={!n} emptyText={t(S.alertsNone)} emptyHint={t(S.alertsHint)}>
        <ul data-guide="al-list" className="grid gap-2">
          {s.data?.map(a => (
            <li key={a.quote_id + a.item_key} className="card flex flex-wrap items-center gap-x-6 gap-y-2 border-l-4 border-l-amber">
              <div className="min-w-0 flex-1 basis-64">
              <p className="font-semibold"><a className="link" href={`#/doc/${a.quote_id}`}>{a.quote_no}</a> <span className="font-normal">{t({ en: `for ${a.customer}`, ms: `untuk ${a.customer}`, zh: `客户：${a.customer}`, ta: `${a.customer} க்கு` })}</span></p>
              <p className="mt-1 text-sm">{t({ en: `${a.item_key}: cost ${rm(a.old_cost)} to ${rm(a.current_cost)}`, ms: `${a.item_key}: kos ${rm(a.old_cost)} kepada ${rm(a.current_cost)}`, zh: `${a.item_key}：成本由 ${rm(a.old_cost)} 变为 ${rm(a.current_cost)}`, ta: `${a.item_key}: செலவு ${rm(a.old_cost)} இலிருந்து ${rm(a.current_cost)} ஆனது` })}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2"><span className="badge badge-warn">{t({ en: `Margin down ${rm(String(Math.abs(Number(a.margin_delta) || 0)))}`, ms: `Margin turun ${rm(String(Math.abs(Number(a.margin_delta) || 0)))}`, zh: `利润减少 ${rm(String(Math.abs(Number(a.margin_delta) || 0)))}`, ta: `மார்ஜின் ${rm(String(Math.abs(Number(a.margin_delta) || 0)))} குறைந்தது` })}</span><Status v={a.status} /></p>
              </div>
              <a className="btn" data-guide="al-review" href={`#/doc/${a.quote_id}`}>{t({ en: `Review ${a.quote_no}`, ms: `Semak ${a.quote_no}`, zh: `审核 ${a.quote_no}`, ta: `${a.quote_no} ஐ மதிப்பாய்வு செய்` })}</a>
            </li>
          ))}
        </ul>
      </Async>
      <Proposals />
    </>
  )
}

// ---------- Activity ----------
// ---------- Pages and shell ----------
/*
  ADD A PAGE: write the view component, add one entry to PAGES (hash route -> title + render), add a nav item in Shell.tsx NAV,
  and, if it needs a permission, one line in NEED in api.ts. Start the view with <PageHeader title=... /> (it sets <title> and is the focus target).
  Detail pages use PageHeader's `back` prop and a route like #/thing/<id> (arg).
*/
interface PageCtx { me: Me; owner: boolean; arg?: string; dark: boolean; setDark: (d: boolean) => void }
// Mock-only test switch: /?crash=1#/contacts throws while rendering, to see the page fallback. MOCK is a build constant, so real builds drop it.
function MockCrash(): never { throw new Error('Mock crash (?crash=1)') }
const NotFound = () => { useLang(); return <><PageHeader title={t(S.notFound)} /><EmptyState title={t(S.notExist)} action={{ label: t(S.openTracker), href: '#/tracker' }} /></> }
const PAGES: Record<string, { render: (c: PageCtx) => ReactNode }> = {
  home: { render: c => <HomeView me={c.me} owner={can('view_costs')} /> },
  revenue: { render: () => <RevenueView /> },
  alerts: { render: () => <AlertsView /> },
  followups: { render: () => <Followups /> },
  tracker: { render: c => <TrackerView owner={can('view_costs')} arg={c.arg} /> },
  suppliers: { render: c => <SuppliersView owner={c.owner} /> },
  supplier: { render: c => c.arg ? <SupplierDetail id={c.arg} /> : <NotFound /> },
  products: { render: c => <ProductsView owner={c.owner} /> },
  product: { render: c => c.arg ? <ProductView id={c.arg} owner={c.owner} /> : <NotFound /> },
  contracts: { render: c => <ContractsView owner={c.owner} /> },
  contract: { render: c => c.arg ? <ContractDetail id={c.arg} owner={c.owner} /> : <NotFound /> },
  contacts: { render: c => <ContactsView owner={can('view_costs')} arg={c.arg} /> },
  contact: { render: c => c.arg ? <ContactDetail id={c.arg} owner={can('view_costs')} /> : <NotFound /> },
  ask: { render: () => <AskView owner={can('view_replies_prices')} /> },
  catalog: { render: c => <CatalogView me={c.me} owner={c.owner} id={c.arg} /> },
  assistant: { render: () => <AssistantView /> },
  search: { render: c => <SearchView q={safeDecode(c.arg)} /> },
  track: { render: () => <TrackView /> },
  jobs: { render: c => <JobsView me={c.me} /> },
  deals: { render: c => <DealsView owner={c.owner} arg={c.arg} /> },
  settings: { render: c => <SettingsView owner={c.owner} setDark={c.setDark} /> },
  team: { render: c => <TeamView owner={c.owner} meId={c.me.id} /> },
  privacy: { render: () => <PrivacyView /> },
  'api-access': { render: () => <ApiAccessView /> },
  'ai-settings': { render: () => <AiSettingsView /> },
  roles: { render: c => <RolesView owner={c.owner} /> },
  account: { render: c => <AccountView name={c.me.name} role={c.me.role_name ?? c.me.role} linked={c.me.telegram_linked} onChange={() => window.dispatchEvent(new Event('laris:branding'))} /> },
  activity: { render: () => <ActivityView /> },
  status: { render: () => <StatusView /> },
  licence: { render: c => <LicenceView owner={c.owner} /> },
  issuer: { render: () => <IssuerView /> },
  purchase: { render: c => <PurchaseView owner={c.owner} backHref="#/licence" /> },
  help: { render: c => <HelpView arg={c.arg} /> },
  doc: { render: c => c.arg ? <DetailView id={c.arg} owner={c.owner} /> : <NotFound /> },
}

// A malformed escape in the hash (#/search/%E0%A4%A) must not throw: treat it as empty.
const safeDecode = (s = '') => { try { return decodeURIComponent(s) } catch { return '' } }
const NOT_ENFORCED: License = { status: 'active', plan: null, seats: null, seats_used: 0, expires_at: null, days_left: null, enforced: false, read_only: false, clock: null }

const AUTH_ORDER: Record<string, number> = { welcome: -1, login: 0, register: 1, forgot: 1 }  // moving to a higher number slides forward
const routeOf = (h: string) => (h.split('/')[1] || 'home').split('?')[0]

// Put a list page back where the reader left it (after Back from a document). Waits for the content to be tall enough; stops if the reader scrolls.
function restoreScroll(y: number) {
  let n = 0, stop = false
  const off = () => { stop = true }
  const evs = ['wheel', 'touchstart', 'keydown'] as const
  evs.forEach(e => addEventListener(e, off, { once: true, passive: true }))
  const tick = () => { if (stop) return; scrollTo(0, y); if (Math.abs(scrollY - y) < 2 || ++n > 180) return; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return () => { stop = true; evs.forEach(e => removeEventListener(e, off)) }
}

export default function App() {
  return <ToastProvider><AppShell /></ToastProvider>
}

/*
  Sign-in states live here: `gate` is 'checking' | 'login' | 'ready'. A new pre-login screen (register, verify, licence) is another gate
  value rendered before the <Shell>; pages only ever render inside the shell once the gate is 'ready' and /api/me has answered.
*/
function AppShell() {
  const toast = useToast()
  const [hash, setHash] = useState(location.hash)
  const [lang] = useLang()  // a language change redraws the page in the new language
  const [role, setRoleState] = useState<Role>(getRole())
  const prev = useRef({ from: location.hash, now: location.hash })
  const seen = useRef(new Map<string, number>())  // route -> scrollY when it was left
  useEffect(() => {
    history.scrollRestoration = 'manual'
    const h = () => {
      seen.current.set(routeOf(prev.current.now), scrollY)  // read before React swaps the page
      const was = routeOf(prev.current.now), to = routeOf(location.hash)
      prev.current = { from: prev.current.now, now: location.hash }
      // Sign-in <-> register <-> forgot: the card slides the way you are going (view transition; see .auth-card in theme.css). Anything else just swaps.
      const a = AUTH_ORDER[was], b = AUTH_ORDER[to]
      if (a !== undefined && b !== undefined && was !== to && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const root = document.documentElement
        root.dataset.authDir = b >= a ? 'fwd' : 'back'
        const next = location.hash
        document.startViewTransition(() => flushSync(() => setHash(next))).finished.finally(() => delete root.dataset.authDir)
      } else setHash(location.hash)
    }
    addEventListener('hashchange', h); return () => removeEventListener('hashchange', h)
  }, [])
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  useEffect(() => { const h = () => setDark(document.documentElement.dataset.theme === 'dark'); addEventListener('laris:theme', h); return () => removeEventListener('laris:theme', h) }, [])  // the device switched between light and dark
  // The user id comes from GET /api/me (X-Role only). Re-resolved whenever the simulated role changes; nothing renders before it.
  const [me, setMe] = useState<Me>()
  const [meErr, setMeErr] = useState('')
  const [tries, setTries] = useState(0)
  // 'login' shows the sign-in screen: when the server needs accounts and this tab has no session, or the session ended.
  const [gate, setGate] = useState<'checking' | 'login' | 'ready'>(MOCK ? 'ready' : 'checking')
  const [demo, setDemo] = useState(false)  // the server still accepts the shared access token (login not required)
  // Licence: undefined until read. Not enforced (the usual case) means nothing in the UI changes. `roOk`: the person chose to continue read-only.
  const [lic, setLic] = useState<License>()
  const [licTries, setLicTries] = useState(0)
  const [roOk, setRoOk] = useState(false)
  const licRetried = useRef(false)
  useEffect(() => {
    if (!MOCK) authConfig().then(c => { setDemo(!c.login_required); setGate(c.login_required && !getToken() ? 'login' : 'ready') }, () => setGate('ready'))
    const out = () => { setMe(undefined); setLic(undefined); setRoOk(false); setGate('login') }
    addEventListener('laris:signedout', out)
    const l402 = () => { toast(t(S.lic402), { href: '#/licence', label: t(S.openLic) }); setLicTries(t => t + 1) }
    addEventListener('laris:license402', l402)
    return () => { removeEventListener('laris:signedout', out); removeEventListener('laris:license402', l402) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gate !== 'ready' || !me) return
    let live = true
    // Failed read (the wrapper already retried once): keep what was known, log, try once more later. Never turns enforcement off by itself.
    api<License>('GET', '/license').then(l => { if (live) { licRetried.current = false; setLicenceOn(l.enforced); setLic(l) } }, e => {
      if (!live) return
      console.warn('Licence check failed', e)
      setLic(p => p ?? NOT_ENFORCED)  // first read: let the app open, the later retry corrects it
      if (!licRetried.current) { licRetried.current = true; setTimeout(() => setLicTries(t => t + 1), 5000) }
    })
    return () => { live = false }
  }, [gate, me?.id, licTries])  // eslint-disable-line react-hooks/exhaustive-deps
  const pub = routeOf(hash) === 'q' || routeOf(hash) === 'd'  // the public customer pages (quote, delivery): no staff request of any kind is made for them
  useEffect(() => {
    if (gate !== 'ready' || pub) return
    let live = true
    setMe(undefined); setMeErr('')
    // With a per-user token the server decides the role; follow it instead of the picker.
    resolveMe(role).then(m => { if (!live) return; if (m.role !== role) { setRole(m.role); setRoleState(m.role) } else setMe(m) }, e => live && setMeErr(msg(e)))
    return () => { live = false }
  }, [role, tries, gate, pub])
  const owner = role === 'owner'
  const [, page, arg] = hash.split('/')
  const route0 = (page || 'home').split('?')[0]  // '#/invite?token=...' is route 'invite'
  const route = route0 === 'alerts' && arg === 'followups' ? 'followups' : route0  // the old #/alerts/followups link opens the Follow-ups page
  useEffect(() => applyBrand(me?.org), [me?.org])
  // Branding saved on the Settings page: re-read /me without blanking the page.
  useEffect(() => {
    const h = () => resolveMe(role).then(setMe, () => undefined)
    addEventListener('laris:branding', h); addEventListener('laris:perms', h)  // a 403 may mean the role changed: re-read /me (permissions)
    return () => { removeEventListener('laris:branding', h); removeEventListener('laris:perms', h) }
  }, [role])
  // On navigation: back to a list from a document restores its scroll position, any other route change starts at the top; focus goes to the page heading.
  const firstNav = useRef(true)
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return }
    const to = routeOf(hash), from = routeOf(prev.current.from)
    const y = (from === 'doc' || from === 'contact') && to !== from ? seen.current.get(to) : undefined
    if (!y && to !== from) scrollTo(0, 0)
    focusTop(!!y || to !== from)
    return y ? restoreScroll(y) : undefined
  }, [hash])
  const onRole = (r: Role) => { setRole(r); setRoleState(r); toast(t({ en: `Viewing as ${r === 'owner' ? 'Owner' : 'Staff'}`, ms: `Melihat sebagai ${t(r === 'owner' ? S.owner : S.staff)}`, zh: `当前身份：${t(r === 'owner' ? S.owner : S.staff)}`, ta: `${t(r === 'owner' ? S.owner : S.staff)} ஆகப் பார்க்கிறீர்கள்` })) }
  if (pub) { const tok = hash.split('/')[2]?.split('?')[0] ?? ''; return routeOf(hash) === 'd' ? <DeliverySign token={tok} /> : <Accept token={tok} /> }  // customer link: outside the shell, no sign-in
  if (gate === 'checking') return <div className="p-6"><Skeleton rows={3} /></div>
  // Signed-out screens (full width, no sidebar): sign in is the default, register and forgot are public routes.
  // Public homepage: #/welcome, and the bare address for a visitor who is not signed in.
  if (route === 'welcome' || (gate === 'login' && ['', '#', '#/'].includes(hash))) return <Landing dark={dark} setDark={setDark} />
  if (route === 'invite') return <AcceptInvite dark={dark} setDark={setDark} />
  if (gate === 'login' || (['login', 'register', 'forgot'].includes(route) && (MOCK || !getToken()))) {
    if (route === 'register') return <Register dark={dark} setDark={setDark} />
    if (route === 'forgot') return <Forgot dark={dark} setDark={setDark} />
    return <Login dark={dark} setDark={setDark} demo={demo} onDone={() => { if (route === 'login') location.hash = '#/home'; setGate('ready'); setTries(t => t + 1) }} />
  }
  const orgName = me?.org.name ?? 'LARIS'
  if (me && lic && blocked(lic) && !roOk) {
    // Enforced and unusable: activation instead of the app (the purchase page is the one other screen).
    if (route === 'purchase') return <OrgCtx value={orgName}><Frame org={orgName} dark={dark} setDark={setDark} wide><PurchaseView owner={owner} backHref="#/licence" /></Frame></OrgCtx>
    return <LicenceGate lic={lic} owner={owner} org={orgName} dark={dark} setDark={setDark} reload={() => setLicTries(t => t + 1)} onReadOnly={() => setRoOk(true)} />
  }
  const entry = PAGES[route]
  return (
    <LicenseProvider value={{ lic, readOnly: !!lic?.enforced && lic.read_only, reload: () => setLicTries(t => t + 1) }}>
    <OrgCtx value={orgName}>
      <Shell me={me} hash={hash} route={route} dark={dark} setDark={setDark} owner={owner} role={role} onRole={onRole} banner={<><OfflineBanner /><LicenceBanner lic={lic} owner={owner} /><HealthBanner owner={owner && !!me} hash={hash} /></>}>
        {meErr ? (
          <div role="alert" className="card border-warn bg-warn-bg text-warn">
            <p>{t(S.noMe)} {meErr}</p>
            <button className="btn mt-3" onClick={() => setTries(t => t + 1)}>{t(S.retryMe)}</button>
          </div>
        ) : !me || !lic ? <Skeleton rows={4} /> : (
          <div key={route + (route === 'doc' || route === 'contact' ? arg : '') + lang} className="page-in">
            {!canOpen(route, owner) ? <>
              <PageHeader title={txOr(`nav.${route}`, t(S.page))} />
              <p role="alert" className="card text-muted">{t(S.denied)}</p>
            </> : (
              <ErrorBoundary level="page">
                {MOCK && route === 'contacts' && new URLSearchParams(location.search).get('crash') === '1' && <MockCrash />}
                {entry ? entry.render({ me, owner, arg, dark, setDark }) : <NotFound />}
              </ErrorBoundary>
            )}
          </div>
        )}
        {me && lic && <AssistantWidget name={me.name} uid={me.id} hidden={route === 'assistant' || !canOpen('assistant', owner)} />}
        {me && lic && <GuidePanel />}
      </Shell>
      {me && <TourHost me={me} owner={owner} />}
      {!MOCK && getAccount() && <IdleGuard />}
    </OrgCtx>
    </LicenseProvider>
  )
}

// Shrink a logo in the browser: draw it at most 512 px on its longest side, then step WebP quality down until it fits 190 KB
// (the stored limit is 200 KB). PNG keeps transparency when it already fits.
const LOGO_MAX = 190 * 1024
const dataUrlBytes = (u: string) => Math.ceil((u.length - u.indexOf(',') - 1) * 3 / 4)
export async function shrinkLogo(file: File): Promise<string> {
  const read = () => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file) })
  const src = await read()
  const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src })
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.size <= LOGO_MAX) return src
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const png = c.toDataURL('image/png')
  if (dataUrlBytes(png) <= LOGO_MAX) return png
  for (const q of [0.92, 0.85, 0.75, 0.6, 0.45]) { const u = c.toDataURL('image/webp', q); if (u.startsWith('data:image/webp') && dataUrlBytes(u) <= LOGO_MAX) return u }
  for (const q of [0.85, 0.7, 0.5]) { const u = c.toDataURL('image/jpeg', q); if (dataUrlBytes(u) <= LOGO_MAX) return u }
  throw new Error('too large')
}
