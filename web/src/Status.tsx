import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { Async, PageHeader, useFetch } from './ui'
import { Icon } from './icons'
import { getLang, t, useLang } from './i18n'
import type { Text } from './i18n'

export type Level = 'ok' | 'info' | 'warn' | 'critical'
export interface HealthItem { level: Exclude<Level, 'ok'>; code: string; message: string; fix: string }
export type SvcState = 'ok' | 'set' | 'warn' | 'down' | 'off'
export interface Service { key: string; state: SvcState }
export interface Health { level: Level; items: HealthItem[]; services?: Service[] }

// Server health text, translated here by code ([message, fix]; {n} = the first number in the server message, {v} = the setting names in a "Set ... in Secrets" fix).
// English and any unknown code show the server's own text. demo_mode and licence_expiring read differently per level, so those are keyed code:level.
const H: Record<string, [Omit<Text, 'en'>, Omit<Text, 'en'>]> = {
  email_off: [
    { ms: 'E-mel dimatikan, jadi kod daftar, set semula kata laluan dan sebut harga tidak dapat dihantar melalui e-mel.', zh: '电子邮件已关闭，因此无法通过邮件发送注册验证码、密码重置和报价单。', ta: 'மின்னஞ்சல் அணைக்கப்பட்டுள்ளது, எனவே பதிவுக் குறியீடுகள், கடவுச்சொல் மீட்டமைப்புகள், விலைப்புள்ளிகளை மின்னஞ்சலில் அனுப்ப முடியாது.' },
    { ms: 'Tetapkan MAILTRAP_API_TOKEN dalam Secrets dan mulakan semula.', zh: '在 Secrets 中设置 MAILTRAP_API_TOKEN，然后重启。', ta: 'Secrets இல் MAILTRAP_API_TOKEN ஐ அமைத்து மீண்டும் தொடங்கவும்.' }],
  email_sandbox: [
    { ms: 'E-mel dihantar ke peti masuk ujian, jadi tiada sesiapa yang menerimanya.', zh: '邮件会发送到测试收件箱，因此没有人会收到。', ta: 'மின்னஞ்சல் சோதனை இன்பாக்ஸுக்குச் செல்கிறது, எனவே யாரும் அதைப் பெற மாட்டார்கள்.' },
    { ms: 'Buang MAILTRAP_INBOX_ID daripada Secrets apabila anda sedia menghantar e-mel sebenar.', zh: '准备好发送真实邮件时，请从 Secrets 中删除 MAILTRAP_INBOX_ID。', ta: 'உண்மையான மின்னஞ்சல் அனுப்பத் தயாரானதும் Secrets இலிருந்து MAILTRAP_INBOX_ID ஐ நீக்கவும்.' }],
  rls_bypass: [
    { ms: 'Log masuk pangkalan data boleh melihat data setiap perniagaan; perniagaan tidak diasingkan.', zh: '数据库登录账号可以看到每家商户的数据，商户之间没有隔离。', ta: 'தரவுத்தள உள்நுழைவு ஒவ்வொரு வணிகத்தின் தரவையும் பார்க்க முடியும்; வணிகங்கள் தனித்தனியாக வைக்கப்படவில்லை.' },
    { ms: 'Sambung sebagai peranan laris_app (db/roles.sql) dalam DATABASE_URL.', zh: '在 DATABASE_URL 中以 laris_app 角色（db/roles.sql）连接。', ta: 'DATABASE_URL இல் laris_app பங்காக (db/roles.sql) இணைக்கவும்.' }],
  'demo_mode:critical': [
    { ms: 'Mod demo dihidupkan: sesiapa yang boleh mencapai tapak ini boleh bertindak sebagai pemilik tanpa log masuk.', zh: '演示模式已开启：任何能访问本站的人都可以不登录就以店主身份操作。', ta: 'டெமோ பயன்முறை இயக்கத்தில் உள்ளது: இந்தத் தளத்தை அணுகக்கூடிய எவரும் உள்நுழையாமல் உரிமையாளராகச் செயல்பட முடியும்.' },
    { ms: 'Tetapkan kata laluan untuk pemilik (BOOTSTRAP_OWNER_USERNAME / BOOTSTRAP_OWNER_PASSWORD), tetapkan REQUIRE_USER_TOKEN=1 dan buang DEMO_MODE.', zh: '为店主设置密码（BOOTSTRAP_OWNER_USERNAME / BOOTSTRAP_OWNER_PASSWORD），设置 REQUIRE_USER_TOKEN=1，并删除 DEMO_MODE。', ta: 'உரிமையாளருக்குக் கடவுச்சொல்லை அமைக்கவும் (BOOTSTRAP_OWNER_USERNAME / BOOTSTRAP_OWNER_PASSWORD), REQUIRE_USER_TOKEN=1 என அமைத்து DEMO_MODE ஐ நீக்கவும்.' }],
  'demo_mode:info': [
    { ms: 'Mod demo dihidupkan: tidak perlu log masuk pada mesin ini.', zh: '演示模式已开启：在这台机器上无需登录。', ta: 'டெமோ பயன்முறை இயக்கத்தில் உள்ளது: இந்தக் கணினியில் உள்நுழைவு தேவையில்லை.' },
    { ms: 'Sebelum beroperasi, buang DEMO_MODE dan berikan kata laluan kepada pemilik.', zh: '正式上线前，请删除 DEMO_MODE 并为店主设置密码。', ta: 'நேரலைக்குச் செல்லும் முன் DEMO_MODE ஐ நீக்கி உரிமையாளருக்குக் கடவுச்சொல் வழங்கவும்.' }],
  scheduler_off: [
    { ms: 'Penjalan latar belakang dimatikan: susulan, tamat tempoh, pembersihan dan peringatan kerja tidak akan berjalan.', zh: '后台任务已关闭：跟进、到期处理、清理和工单提醒都不会运行。', ta: 'பின்னணி இயக்கி அணைக்கப்பட்டுள்ளது: பின்தொடர்வுகள், காலாவதி, சுத்தம் செய்தல், வேலை நினைவூட்டல்கள் இயங்காது.' },
    { ms: 'Tetapkan SCHEDULER=1 dalam Secrets dan mulakan semula.', zh: '在 Secrets 中设置 SCHEDULER=1，然后重启。', ta: 'Secrets இல் SCHEDULER=1 என அமைத்து மீண்டும் தொடங்கவும்.' }],
  scheduler_failing: [
    { ms: 'Larian latar belakang terakhir mempunyai ralat, jadi sesetengah susulan atau peringatan mungkin terlepas.', zh: '上一次后台运行出现错误，部分跟进或提醒可能被跳过。', ta: 'கடைசி பின்னணி இயக்கத்தில் பிழைகள் இருந்தன, எனவே சில பின்தொடர்வுகள் அல்லது நினைவூட்டல்கள் தவிர்க்கப்பட்டிருக்கலாம்.' },
    { ms: "Semak log pelayan untuk baris 'scheduler'.", zh: "查看服务器日志中带 'scheduler' 的行。", ta: "சேவையகப் பதிவில் 'scheduler' வரிகளைச் சரிபார்க்கவும்." }],
  ntp_offline: [
    { ms: 'Pelayan tidak dapat mencapai perkhidmatan masa internet, jadi lesen menggunakan jam mesin sendiri.', zh: '服务器无法连接互联网时间服务，因此许可证使用本机时钟。', ta: 'சேவையகத்தால் இணைய நேர சேவையை அடைய முடியவில்லை, எனவே உரிமம் கணினியின் சொந்த கடிகாரத்தைப் பயன்படுத்துகிறது.' },
    { ms: 'Benarkan UDP port 123 keluar (pool.ntp.org, time.google.com).', zh: '允许出站 UDP 端口 123（pool.ntp.org、time.google.com）。', ta: 'வெளிச்செல்லும் UDP போர்ட் 123 ஐ அனுமதிக்கவும் (pool.ntp.org, time.google.com).' }],
  'licence_expiring:critical': [
    { ms: 'Lesen anda telah tamat tempoh dan perubahan dijeda.', zh: '您的许可证已过期，更改已暂停。', ta: 'உங்கள் உரிமம் காலாவதியாகிவிட்டது, மாற்றங்கள் இடைநிறுத்தப்பட்டுள்ளன.' },
    { ms: 'Pemilik: buka Lesen, mohon atau aktifkan lesen baharu.', zh: '店主：打开“许可证”，申请或激活新的许可证。', ta: 'உரிமையாளர்: உரிமம் பக்கத்தைத் திறந்து புதிய உரிமத்தைக் கோரவும் அல்லது செயல்படுத்தவும்.' }],
  'licence_expiring:warn': [
    { ms: 'Lesen anda tamat dalam {n} hari.', zh: '您的许可证将在 {n} 天后到期。', ta: 'உங்கள் உரிமம் {n} நாளில் முடிகிறது.' },
    { ms: 'Pemilik: buka Lesen dan mohon pembaharuan.', zh: '店主：打开“许可证”并申请续期。', ta: 'உரிமையாளர்: உரிமம் பக்கத்தைத் திறந்து புதுப்பிப்பைக் கோரவும்.' }],
  ilmu_not_set: [
    { ms: 'AI yang membaca mesej pelanggan belum disediakan.', zh: '读取客户消息的 AI 尚未设置。', ta: 'வாடிக்கையாளர் செய்திகளைப் படிக்கும் AI அமைக்கப்படவில்லை.' },
    { ms: 'Tetapkan ILMU_API_KEY dalam Secrets dan mulakan semula.', zh: '在 Secrets 中设置 ILMU_API_KEY，然后重启。', ta: 'Secrets இல் ILMU_API_KEY ஐ அமைத்து மீண்டும் தொடங்கவும்.' }],
  vision_not_set: [
    { ms: 'Pembacaan foto produk belum disediakan.', zh: '产品照片识别尚未设置。', ta: 'தயாரிப்புப் படங்களைப் படிப்பது அமைக்கப்படவில்லை.' },
    { ms: 'Tetapkan {v} dalam Secrets dan mulakan semula.', zh: '在 Secrets 中设置 {v}，然后重启。', ta: 'Secrets இல் {v} ஐ அமைத்து மீண்டும் தொடங்கவும்.' }],
  whatsapp_not_set: [
    { ms: 'WhatsApp belum disambungkan.', zh: 'WhatsApp 尚未连接。', ta: 'WhatsApp இணைக்கப்படவில்லை.' },
    { ms: 'Tetapkan WHATSAPP_TOKEN dan WHATSAPP_PHONE_NUMBER_ID dalam Secrets.', zh: '在 Secrets 中设置 WHATSAPP_TOKEN 和 WHATSAPP_PHONE_NUMBER_ID。', ta: 'Secrets இல் WHATSAPP_TOKEN மற்றும் WHATSAPP_PHONE_NUMBER_ID ஐ அமைக்கவும்.' }],
  telegram_not_set: [
    { ms: 'Telegram belum disambungkan.', zh: 'Telegram 尚未连接。', ta: 'Telegram இணைக்கப்படவில்லை.' },
    { ms: 'Sambungkan bot Telegram anda di bawah Saluran.', zh: '在“渠道”下连接您的 Telegram 机器人。', ta: 'சேனல்கள் பக்கத்தில் உங்கள் Telegram பாட்டை இணைக்கவும்.' }],
  telegram_helper_not_set: [
    { ms: 'Bot pembantu LARIS belum disediakan, jadi pemilik dan kakitangan tidak dapat memautkan akaun Telegram mereka.', zh: 'LARIS 助手机器人尚未设置，店主和员工无法绑定各自的 Telegram 账号。', ta: 'LARIS உதவி பாட் அமைக்கப்படவில்லை, எனவே உரிமையாளர்களும் ஊழியர்களும் தங்கள் Telegram கணக்குகளை இணைக்க முடியாது.' },
    { ms: 'Tetapkan LARIS_HELPER_BOT_TOKEN dan LARIS_HELPER_WEBHOOK_SECRET dalam Secrets, kemudian daftarkan webhook-nya.', zh: '在 Secrets 中设置 LARIS_HELPER_BOT_TOKEN 和 LARIS_HELPER_WEBHOOK_SECRET，然后注册其 webhook。', ta: 'Secrets இல் LARIS_HELPER_BOT_TOKEN மற்றும் LARIS_HELPER_WEBHOOK_SECRET ஐ அமைத்து, அதன் webhook ஐப் பதிவு செய்யவும்.' }],
  ocr_missing: [
    { ms: 'Pembacaan teks untuk dokumen imbasan (Tesseract) tidak dipasang.', zh: '扫描文档的文字识别（Tesseract）未安装。', ta: 'ஸ்கேன் செய்த ஆவணங்களுக்கான எழுத்து வாசிப்பு (Tesseract) நிறுவப்படவில்லை.' },
    { ms: 'Pasang Tesseract pada pelayan, atau pasang paddleocr.', zh: '在服务器上安装 Tesseract，或安装 paddleocr。', ta: 'சேவையகத்தில் Tesseract ஐ நிறுவவும், அல்லது paddleocr ஐ நிறுவவும்.' }],
  public_url_unset: [
    { ms: 'Alamat awam tapak belum ditetapkan, jadi pautan dalam e-mel mungkin salah.', zh: '站点的公开网址尚未设置，邮件中的链接可能不正确。', ta: 'தளத்தின் பொது முகவரி அமைக்கப்படவில்லை, எனவே மின்னஞ்சலில் உள்ள இணைப்புகள் தவறாக இருக்கலாம்.' },
    { ms: 'Tetapkan APP_PUBLIC_URL (contohnya https://yourshop.example) dalam Secrets.', zh: '在 Secrets 中设置 APP_PUBLIC_URL（例如 https://yourshop.example）。', ta: 'Secrets இல் APP_PUBLIC_URL ஐ அமைக்கவும் (எ.கா. https://yourshop.example).' }],
  secret_key_unset: [
    { ms: 'Tiada kunci rahsia ditetapkan, jadi kod keselamatan diterbitkan daripada alamat pangkalan data.', zh: '未设置密钥，因此安全码由数据库地址生成。', ta: 'ரகசியச் சாவி அமைக்கப்படவில்லை, எனவே பாதுகாப்புக் குறியீடுகள் தரவுத்தள முகவரியிலிருந்து உருவாக்கப்படுகின்றன.' },
    { ms: 'Tetapkan SECRET_KEY kepada nilai rawak yang panjang dalam Secrets.', zh: '在 Secrets 中把 SECRET_KEY 设置为一个很长的随机值。', ta: 'Secrets இல் SECRET_KEY ஐ நீண்ட சீரற்ற மதிப்பாக அமைக்கவும்.' }],
  proxy_not_trusted: [
    { ms: 'Setiap pelawat kelihatan seperti alamat yang sama, jadi satu siri log masuk yang gagal boleh mengunci semua orang.', zh: '所有访客看起来都是同一个地址，所以一次连续的登录失败可能会把所有人锁在外面。', ta: 'ஒவ்வொரு பார்வையாளரும் ஒரே முகவரியாகத் தெரிகிறார்கள், எனவே தொடர்ச்சியான தவறான உள்நுழைவுகள் அனைவரையும் பூட்டிவிடக்கூடும்.' },
    { ms: 'Tetapkan TRUST_PROXY=1 dalam Secrets.', zh: '在 Secrets 中设置 TRUST_PROXY=1。', ta: 'Secrets இல் TRUST_PROXY=1 என அமைக்கவும்.' }],
  no_owner_email: [
    { ms: 'Tiada pemilik aktif mempunyai alamat e-mel, jadi tiada sesiapa dapat memulihkan kata laluan yang hilang.', zh: '没有任何在职店主设置了电子邮箱，因此无法找回丢失的密码。', ta: 'செயலில் உள்ள எந்த உரிமையாளருக்கும் மின்னஞ்சல் முகவரி இல்லை, எனவே தொலைந்த கடவுச்சொல்லை யாரும் மீட்க முடியாது.' },
    { ms: 'Tambah e-mel pada akaun pemilik di bawah Pasukan.', zh: '在“团队”下为店主账号添加电子邮箱。', ta: 'குழு பக்கத்தில் உரிமையாளரின் கணக்கில் மின்னஞ்சலைச் சேர்க்கவும்.' }],
  privacy_dpo_missing: [
    { ms: 'Tiada hubungan pegawai perlindungan data direkodkan (PDPA yang dipinda memintanya).', zh: '尚未记录数据保护官的联系方式（修订后的 PDPA 要求提供）。', ta: 'தரவுப் பாதுகாப்பு அதிகாரியின் தொடர்பு பதிவு செய்யப்படவில்லை (திருத்தப்பட்ட PDPA இதைக் கோருகிறது).' },
    { ms: 'Pemilik: tambah nama dan e-mel atau telefon pegawai di bawah Tetapan, Privasi.', zh: '店主：在“设置”的“隐私”中添加该负责人的姓名以及电子邮箱或电话。', ta: 'உரிமையாளர்: அமைப்புகள், தனியுரிமை பகுதியில் அதிகாரியின் பெயர் மற்றும் மின்னஞ்சல் அல்லது தொலைபேசியைச் சேர்க்கவும்.' }],
  breach_overdue: [
    { ms: '{n} pelanggaran data terbuka telah melepasi 72 jam tanpa notis kepada Pesuruhjaya direkodkan.', zh: '有 {n} 起未结数据泄露已超过 72 小时，仍未记录向专员的通报。', ta: '{n} திறந்த தரவு மீறல்கள் 72 மணி நேரத்தைக் கடந்தும் ஆணையருக்கு அறிவிப்பு பதிவு செய்யப்படவில்லை.' },
    { ms: 'Pemilik: maklumkan Pesuruhjaya sekarang (sahkan peraturan di pdp.gov.my) dan rekodkan masanya dalam daftar pelanggaran.', zh: '店主：立即通知专员（请在 pdp.gov.my 确认规定），并在泄露登记册中记录时间。', ta: 'உரிமையாளர்: உடனே ஆணையருக்கு அறிவிக்கவும் (விதியை pdp.gov.my இல் உறுதிசெய்யவும்) மற்றும் மீறல் பதிவேட்டில் நேரத்தைப் பதிவு செய்யவும்.' }],
  ai_not_reviewed: [
    { ms: 'Pembantu masih berfungsi dalam mod lamanya kerana tetapan AI belum disemak.', zh: '由于 AI 设置尚未审核，助手仍以旧模式运行。', ta: 'AI அமைப்புகள் மதிப்பாய்வு செய்யப்படாததால் உதவியாளர் இன்னும் பழைய பயன்முறையில் செயல்படுகிறது.' },
    { ms: 'Pemilik: semak tetapan AI dan pilih Mati, Panduan sahaja, atau Panduan serta data saya.', zh: '店主：审核 AI 设置，并选择“关闭”“仅提供指引”或“指引加我的数据”。', ta: 'உரிமையாளர்: AI அமைப்புகளை மதிப்பாய்வு செய்து அணை, வழிகாட்டி மட்டும், அல்லது வழிகாட்டி மற்றும் என் தரவு என்பதைத் தேர்வு செய்யவும்.' }],
  privacy_requests_waiting: [
    { ms: '{n} permintaan privasi pelanggan telah menunggu lebih daripada 3 hari.', zh: '有 {n} 个客户隐私请求已等待超过 3 天。', ta: '{n} வாடிக்கையாளர் தனியுரிமை கோரிக்கைகள் 3 நாட்களுக்கு மேல் காத்திருக்கின்றன.' },
    { ms: 'Pemilik: buka Tetapan, Privasi, dan padam atau ketepikan setiap permintaan.', zh: '店主：打开“设置”的“隐私”，逐一删除或驳回每个请求。', ta: 'உரிமையாளர்: அமைப்புகள், தனியுரிமை பகுதியைத் திறந்து ஒவ்வொரு கோரிக்கையையும் அழிக்கவும் அல்லது நிராகரிக்கவும்.' }],
}
// The message and fix of a health item in the current language.
export function healthText(i: HealthItem): { message: string; fix: string } {
  const e = H[`${i.code}:${i.level}`] ?? H[i.code]
  if (!e || getLang() === 'en') return { message: i.message, fix: i.fix }
  const n = i.message.match(/\d+/)?.[0] ?? '', v = i.fix.match(/^Set (.+) in Secrets/)?.[1] ?? ''
  const f = (x: Omit<Text, 'en'>) => t({ en: '', ...x }).replace('{n}', n).replace('{v}', v)
  return { message: f(e[0]), fix: f(e[1]) }
}

// One tile per service. ok = checked just now; set = configured but not tested live (LARIS never calls Telegram, ILMU and the rest from here).
const SVC: Record<string, Text> = {
  database: { en: 'Database', ms: 'Pangkalan data', zh: '数据库', ta: 'தரவுத்தளம்' },
  licence: { en: 'Licence', ms: 'Lesen', zh: '许可证', ta: 'உரிமம்' },
  clock: { en: 'Trusted clock (NTP)', ms: 'Jam dipercayai (NTP)', zh: '可信时钟 (NTP)', ta: 'நம்பகமான கடிகாரம் (NTP)' },
  scheduler: { en: 'Background runner', ms: 'Penjalan latar belakang', zh: '后台任务', ta: 'பின்னணி இயக்கி' },
  rag: { en: 'Record search (RAG)', ms: 'Carian rekod (RAG)', zh: '记录检索 (RAG)', ta: 'பதிவுத் தேடல் (RAG)' },
  mcp: { en: 'MCP server', ms: 'Pelayan MCP', zh: 'MCP 服务器', ta: 'MCP சேவையகம்' },
  ilmu: { en: 'ILMU (messages, voice)', ms: 'ILMU (mesej, suara)', zh: 'ILMU（消息、语音）', ta: 'ILMU (செய்திகள், குரல்)' },
  vision: { en: 'Photo reading (RunPod)', ms: 'Bacaan foto (RunPod)', zh: '照片识别 (RunPod)', ta: 'படம் வாசிப்பு (RunPod)' },
  ocr: { en: 'Document OCR (Tesseract)', ms: 'OCR dokumen (Tesseract)', zh: '文档 OCR (Tesseract)', ta: 'ஆவண OCR (Tesseract)' },
  email: { en: 'Email (Mailtrap)', ms: 'E-mel (Mailtrap)', zh: '电子邮件 (Mailtrap)', ta: 'மின்னஞ்சல் (Mailtrap)' },
  telegram: { en: 'Telegram bot', ms: 'Bot Telegram', zh: 'Telegram 机器人', ta: 'Telegram பாட்' },
  telegram_helper: { en: 'Telegram helper bot', ms: 'Bot pembantu Telegram', zh: 'Telegram 助手机器人', ta: 'Telegram உதவி பாட்' },
  whatsapp: { en: 'WhatsApp', ms: 'WhatsApp', zh: 'WhatsApp', ta: 'WhatsApp' },
}
const SVC_STATE: Record<SvcState, Text> = {
  ok: { en: 'Working', ms: 'Berfungsi', zh: '正常', ta: 'செயல்படுகிறது' },
  set: { en: 'Set up', ms: 'Disediakan', zh: '已设置', ta: 'அமைக்கப்பட்டது' },
  warn: { en: 'Problem', ms: 'Masalah', zh: '有问题', ta: 'சிக்கல்' },
  down: { en: 'Down', ms: 'Terhenti', zh: '故障', ta: 'செயலிழந்தது' },
  off: { en: 'Not set up', ms: 'Belum disediakan', zh: '未设置', ta: 'அமைக்கப்படவில்லை' },
}
const SVC_ORDER: SvcState[] = ['down', 'warn', 'off', 'set', 'ok']
const svcTitle = { en: 'Services', ms: 'Perkhidmatan', zh: '服务', ta: 'சேவைகள்' } satisfies Text
const svcNote = { en: '"Working" was checked just now. "Set up" means the key or token is in place; LARIS does not call the outside service to test it.', ms: '"Berfungsi" disemak sebentar tadi. "Disediakan" bermakna kunci atau token ada; LARIS tidak memanggil perkhidmatan luar untuk mengujinya.', zh: '“正常”表示刚刚检查过。“已设置”表示密钥或令牌已就位；LARIS 不会调用外部服务来测试。', ta: '"செயல்படுகிறது" என்பது இப்போதே சரிபார்க்கப்பட்டது. "அமைக்கப்பட்டது" என்றால் சாவி அல்லது டோக்கன் உள்ளது; வெளிச் சேவையை LARIS அழைத்துச் சோதிக்காது.' } satisfies Text

function Services({ list }: { list: Service[] }) {
  useLang()
  const sorted = [...list].sort((a, b) => SVC_ORDER.indexOf(a.state) - SVC_ORDER.indexOf(b.state))
  const bad = (x: SvcState) => x === 'down' || x === 'warn'
  return (
    <section aria-labelledby="st-services" className="mb-6" data-guide="sys-services">
      <h2 id="st-services" className="mb-1 text-lg font-semibold">{t(svcTitle)} <span className="text-sm font-normal text-muted">({list.length})</span></h2>
      <p className="mb-2 text-sm text-muted">{t(svcNote)}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(v => (
          <li key={v.key} className={`card flex items-center justify-between gap-2 ${bad(v.state) ? 'border-l-4 border-l-amber' : ''}`}>
            <span className="font-semibold">{SVC[v.key] ? t(SVC[v.key]) : v.key}</span>
            <span className={`badge ${bad(v.state) ? 'badge-warn' : ''}`}>{bad(v.state) && <Icon name="warn" className="size-4" />}{t(SVC_STATE[v.state])}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const ORDER: HealthItem['level'][] = ['critical', 'warn', 'info']
const NAME = {
  ok: { en: 'OK', ms: 'OK', zh: '正常', ta: 'சரி' },
  info: { en: 'Info', ms: 'Maklumat', zh: '信息', ta: 'தகவல்' },
  warn: { en: 'Warning', ms: 'Amaran', zh: '警告', ta: 'எச்சரிக்கை' },
  critical: { en: 'Critical', ms: 'Kritikal', zh: '严重', ta: 'முக்கியமானது' },
} satisfies Record<Level, Text>
const GROUP = {
  critical: { en: 'Critical', ms: 'Kritikal', zh: '严重', ta: 'முக்கியமானது' },
  warn: { en: 'Warnings', ms: 'Amaran', zh: '警告', ta: 'எச்சரிக்கைகள்' },
  info: { en: 'For your information', ms: 'Untuk makluman anda', zh: '供您参考', ta: 'உங்கள் தகவலுக்கு' },
} satisfies Record<HealthItem['level'], Text>
const itemsOf = (n: number) => t({ en: `${n} ${n === 1 ? 'item' : 'items'}`, ms: `${n} item`, zh: `${n} 项`, ta: `${n} உருப்படிகள்` })
const sorted = (items: HealthItem[]) => [...items].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))

function LevelBadge({ level }: { level: Level }) {
  useLang()
  const bad = level === 'warn' || level === 'critical'
  return <span className={`badge ${bad ? 'badge-warn' : ''}`}>{bad && <Icon name="warn" className="size-4" />}{t(NAME[level])}</span>
}

// #/status (owner only): what is not set up or not working, worst first, each with how to fix it.
export function StatusView() {
  useLang()
  const s = useFetch<Health>('/system/health')
  const h = s.data
  const items = h?.items ?? []
  return (
    <>
      <PageHeader title={t({ en: 'System status', ms: 'Status sistem', zh: '系统状态', ta: 'கணினி நிலை' })} description={t({ en: 'Checks that LARIS is set up and working, and what to do about anything that is not.', ms: 'Semakan bahawa LARIS telah disediakan dan berfungsi, serta apa yang perlu dilakukan jika tidak.', zh: '检查 LARIS 是否已设置好并正常运行，以及出现问题时该怎么做。', ta: 'LARIS அமைக்கப்பட்டு செயல்படுகிறதா என்பதையும், இல்லையெனில் என்ன செய்வது என்பதையும் சரிபார்க்கிறது.' })} />
      <Async s={s} empty={!!h && !items.length && !h.services?.length} emptyText={t({ en: 'Everything is set up', ms: 'Semuanya telah disediakan', zh: '一切都已设置好', ta: 'அனைத்தும் அமைக்கப்பட்டுள்ளன' })} emptyHint={t({ en: 'Nothing needs your attention right now.', ms: 'Tiada apa yang memerlukan perhatian anda sekarang.', zh: '目前没有需要您处理的事项。', ta: 'இப்போது உங்கள் கவனம் தேவைப்படுவது எதுவும் இல்லை.' })} rows={3}>
        {h && <>
          {h.services && h.services.length > 0 && <Services list={h.services} />}
          <p role="status" data-guide="sys-overall" className="mb-4 flex flex-wrap items-center gap-2 text-lg font-semibold">{t({ en: 'Overall:', ms: 'Keseluruhan:', zh: '总体：', ta: 'ஒட்டுமொத்தம்:' })} <LevelBadge level={h.level} /> <span className="text-sm font-normal text-muted">{itemsOf(items.length)}</span></p>
          {ORDER.map(l => {
            const g = items.filter(i => i.level === l)
            return g.length > 0 && (
              <section key={l} aria-labelledby={`st-${l}`} className="mb-6" data-guide="sys-group">
                <h2 id={`st-${l}`} className="mb-2 text-lg font-semibold">{t(GROUP[l])} <span className="text-sm font-normal text-muted">({g.length})</span></h2>
                <ul className="grid gap-2">
                  {g.map(i => (
                    <li key={i.code} data-guide="sys-fix" className={`card ${l === 'info' ? '' : 'border-l-4 border-l-amber'}`}>
                      <p className="flex flex-wrap items-center gap-2"><LevelBadge level={l} /><span className="font-semibold">{healthText(i).message}</span></p>
                      <p className="mt-2 text-sm"><strong>{t({ en: 'How to fix: ', ms: 'Cara membetulkan: ', zh: '解决方法：', ta: 'சரிசெய்வது எப்படி: ' })}</strong>{healthText(i).fix}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </>}
      </Async>
    </>
  )
}

const KEY = 'laris.health.dismissed'
const read = () => { try { return sessionStorage.getItem(KEY) } catch { return null } }
const FIVE_MIN = 5 * 60_000

// Owner-only strip above the page when something is wrong. A non-owner never calls the endpoint. A failed read shows nothing.
export function HealthBanner({ owner, hash }: { owner: boolean; hash: string }) {
  useLang()
  const [h, setH] = useState<Health>()
  const [gone, setGone] = useState(read)
  const last = useRef(0)
  useEffect(() => {
    if (!owner) { setH(undefined); last.current = 0; return }
    if (Date.now() - last.current < FIVE_MIN) return
    last.current = Date.now()
    let live = true
    api<Health>('GET', '/system/health', undefined, { quiet: true }).then(r => live && setH(r), () => { if (live) setH(undefined) })
    return () => { live = false }
  }, [owner, hash])
  if (!owner || !h || (h.level !== 'warn' && h.level !== 'critical') || !h.items.length) return null
  const items = sorted(h.items)
  const sig = h.level + ':' + items.map(i => i.code).sort().join(',')
  if (gone === sig) return null
  const rest = items.length - 1
  return (
    <div role="region" aria-label={t({ en: 'System status notice', ms: 'Notis status sistem', zh: '系统状态通知', ta: 'கணினி நிலை அறிவிப்பு' })} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-warn-bg px-4 py-2 text-center text-sm text-warn">
      <span className="inline-flex items-center gap-2"><Icon name="warn" className="size-4 shrink-0" /><span><strong>{t(NAME[h.level])}: </strong>{healthText(items[0]).message}{rest > 0 && t({ en: ` (and ${rest} more ${rest === 1 ? 'item' : 'items'})`, ms: ` (dan ${rest} item lagi)`, zh: `（还有 ${rest} 项）`, ta: ` (மேலும் ${rest} உருப்படிகள்)` })}</span></span>
      <span className="flex items-center gap-3 font-semibold">
        <a className="inline-flex min-h-11 items-center underline underline-offset-2" href="#/status">{t({ en: 'See all', ms: 'Lihat semua', zh: '查看全部', ta: 'அனைத்தையும் பார்' })}</a>
        <button type="button" className="inline-flex min-h-11 items-center underline underline-offset-2" onClick={() => { try { sessionStorage.setItem(KEY, sig) } catch { /* storage blocked */ } setGone(sig) }}>{t({ en: 'Dismiss', ms: 'Tolak', zh: '关闭', ta: 'நிராகரி' })}<span className="sr-only">{t({ en: ' this notice', ms: ' notis ini', zh: ' 此通知', ta: ' இந்த அறிவிப்பை' })}</span></button>
      </span>
    </div>
  )
}
