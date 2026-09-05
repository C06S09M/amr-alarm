import express from 'express';
import webpush from 'web-push';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import multer from 'multer';
import { load, save, get } from './store.js';
import { evaluate } from './rules.js';
import { answerTasks, buildBrief, summarizeCall } from './brief.js';
import { transcribeAudio } from './transcribe.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const INGEST_TOKEN = process.env.INGEST_TOKEN || 'change-me-token';
const APP_PASSWORD = '';
const sessions = new Set();

// ---- VAPID (웹푸시) 설정 ----
let PUB = process.env.VAPID_PUBLIC_KEY;
let PRIV = process.env.VAPID_PRIVATE_KEY;
if (!PUB || !PRIV) {
  const k = webpush.generateVAPIDKeys();       // 개발용 임시키 (재시작 시 구독 무효 → 운영은 .env에 고정키 넣기)
  PUB = k.publicKey; PRIV = k.privateKey;
  console.warn('[경고] VAPID 고정키가 없어 임시키로 실행합니다. 운영 배포 전 npm run genkeys 로 키를 만들어 .env에 넣으세요.');
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', PUB, PRIV);

load();

app.set('trust proxy', 1);

function cookieOptions() {
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function requireAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const match = (req.headers.cookie || '').match(/(?:^|; )amr_session=([^;]+)/);
  if (match && sessions.has(match[1])) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'login_required' });
  res.redirect('/login.html');
}

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));      // MacroDroid form 전송 지원
app.get(['/', '/index.html'], requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- 앱 로그인 ----
app.get('/api/auth/status', (req, res) => {
  if (!APP_PASSWORD) return res.json({ enabled: false, authenticated: true });
  const match = (req.headers.cookie || '').match(/(?:^|; )amr_session=([^;]+)/);
  res.json({ enabled: true, authenticated: !!(match && sessions.has(match[1])) });
});
app.post('/api/auth/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true, enabled: false });
  const supplied = String(req.body && req.body.password || '');
  const expected = Buffer.from(APP_PASSWORD);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  res.setHeader('Set-Cookie', `amr_session=${token}; ${cookieOptions()}`);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const match = (req.headers.cookie || '').match(/(?:^|; )amr_session=([^;]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'amr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/auth/status') return next();
  if (req.path === '/ingest' || req.path === '/upload-call') return next();
  return requireAuth(req, res, next);
});

const now = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- 푸시 발송 헬퍼 ----
async function pushAll(payload) {
  const db = get();
  const body = JSON.stringify({
    ...payload,
    sound: db.settings.alarmSound,
    vibrate: db.settings.alarmVibrate
  });
  const stale = [];
  await Promise.all(db.subscriptions.map(async (s) => {
    try {
      await webpush.sendNotification(s, body);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) stale.push(s.endpoint);
    }
  }));
  if (stale.length) {
    db.subscriptions = db.subscriptions.filter((s) => !stale.includes(s.endpoint));
    save();
  }
}

// ---- 설정: 앱에 넘길 공개키 ----
app.get('/api/config', (_req, res) => res.json({ vapidPublicKey: PUB }));

// ---- 캡처 수신 (MacroDroid → 여기로 POST) ----
// 인증: ?token= 또는 헤더 x-token. body/query 모두 허용.
app.all('/api/ingest', async (req, res) => {
  const token = req.query.token || req.headers['x-token'] || req.body.token;
  if (token !== INGEST_TOKEN) return res.status(401).json({ error: 'bad token' });

  const src = { ...req.query, ...req.body };
  const cap = {
    id: uid(),
    ts: now(),
    source: (src.source || 'unknown').toString().slice(0, 40),   // kakao / sms / call / whatsapp / voicetalk
    sender: (src.sender || '').toString().slice(0, 120),
    title: (src.title || '').toString().slice(0, 200),
    text: (src.text || '').toString().slice(0, 1000),
    type: (src.type || 'msg').toString().slice(0, 20)
  };
  const db = get();
  const { urgent, matched, categories } = evaluate(cap, db.rules);
  cap.urgent = urgent;
  cap.matched = matched;
  cap.categories = categories;
  cap.category = categories[0] || '일반';
  db.captures.unshift(cap);
  if (db.captures.length > 500) db.captures.length = 500;   // 최근 500건 유지
  save();

  if (urgent && !db.settings.muteAll) {
    await pushAll({
      title: `⚡ ${cap.source.toUpperCase()} · ${matched.join(', ')}`,
      body: `${cap.sender ? cap.sender + ': ' : ''}${cap.title || cap.text}`.slice(0, 160),
      tag: cap.id,
      url: '/'
    });
  }
  res.json({ ok: true, id: cap.id, urgent, matched });
});

// ---- 통화 녹음 업로드 (MacroDroid가 녹음 파일을 여기로 올림) → 전사 → 요청 요약 → 캡처 ----
app.post('/api/upload-call', upload.any(), async (req, res) => {
  const b = req.body || {};
  if ((req.query.token || b.token) !== INGEST_TOKEN) return res.status(401).json({ error: 'bad token' });
  const file = (req.files && req.files[0]) || null;

  const db = get();
  let transcript = null, title = '통화(녹음)';
  if (file) {
    const tr = await transcribeAudio(file.buffer, file.originalname || 'call.m4a');
    transcript = tr.text;
    if (transcript) title = (await summarizeCall(transcript)) || transcript.slice(0, 80);
    else title = '통화 녹음(전사 미설정)';
  }
  const cap = {
    id: uid(), ts: now(), source: 'call', type: 'call',
    sender: (b.number || b.sender || '').toString().slice(0, 120),
    title: title,
    text: transcript || (b.text || `통화 ${b.duration || ''}`).toString().slice(0, 4000),
    duration: (b.duration || '').toString().slice(0, 20)
  };
  const { urgent, matched, categories } = evaluate(cap, db.rules);
  cap.urgent = urgent; cap.matched = matched; cap.categories = categories; cap.category = categories[0] || '일반';
  db.captures.unshift(cap);
  if (db.captures.length > 500) db.captures.length = 500;
  save();

  if (urgent && !db.settings.muteAll) {
    await pushAll({
      title: `📞 통화 요청 · ${matched.join(', ')}`,
      body: `${cap.sender ? cap.sender + ': ' : ''}${cap.title}`.slice(0, 160),
      tag: cap.id, url: '/'
    });
  }
  res.json({ ok: true, id: cap.id, transcribed: !!transcript, urgent, matched });
});

// ---- 푸시 구독 저장/해제 ----
app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'no subscription' });
  const db = get();
  if (!db.subscriptions.find((s) => s.endpoint === sub.endpoint)) db.subscriptions.push(sub);
  save();
  res.json({ ok: true, count: db.subscriptions.length });
});
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  const db = get();
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== endpoint);
  save();
  res.json({ ok: true });
});

// ---- 테스트 푸시 ----
app.post('/api/test-push', async (_req, res) => {
  await pushAll({ title: '🔔 테스트 알람', body: 'AMR 캡처 알람이 정상 동작합니다.', url: '/' });
  res.json({ ok: true, sent: get().subscriptions.length });
});

// ---- 예약 알람 ----
function normalizeAlarm(input) {
  const time = String(input.time || '');
  const days = Array.isArray(input.days)
    ? [...new Set(input.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  if (!days.length) return null;
  return {
    id: input.id || uid(),
    time,
    label: String(input.label || '예약 알람').trim().slice(0, 80) || '예약 알람',
    days,
    enabled: input.enabled !== false,
    lastFired: input.lastFired || ''
  };
}

app.get('/api/alarms', (_req, res) => res.json({ alarms: get().alarms }));
app.post('/api/alarms', (req, res) => {
  const alarm = normalizeAlarm(req.body || {});
  if (!alarm) return res.status(400).json({ error: '시간과 반복 요일을 확인하세요.' });
  const db = get();
  db.alarms.push(alarm);
  save();
  res.json({ ok: true, alarm });
});
app.patch('/api/alarms/:id', (req, res) => {
  const db = get();
  const index = db.alarms.findIndex((alarm) => alarm.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '알람을 찾을 수 없습니다.' });
  const alarm = normalizeAlarm({ ...db.alarms[index], ...req.body, id: req.params.id });
  if (!alarm) return res.status(400).json({ error: '시간과 반복 요일을 확인하세요.' });
  db.alarms[index] = alarm;
  save();
  res.json({ ok: true, alarm });
});
app.delete('/api/alarms/:id', (req, res) => {
  const db = get();
  db.alarms = db.alarms.filter((alarm) => alarm.id !== req.params.id);
  save();
  res.json({ ok: true });
});

function checkScheduledAlarms() {
  const db = get();
  if (db.settings.muteAll) return;
  const current = new Date();
  const date = current.toLocaleDateString('sv-SE', { timeZone: TZ });
  const time = current.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(current).replace(/^Sun$/, '0').replace(/^Mon$/, '1').replace(/^Tue$/, '2').replace(/^Wed$/, '3').replace(/^Thu$/, '4').replace(/^Fri$/, '5').replace(/^Sat$/, '6'));
  for (const alarm of db.alarms) {
    if (!alarm.enabled || alarm.time !== time || !alarm.days.includes(weekday) || alarm.lastFired === `${date} ${time}`) continue;
    alarm.lastFired = `${date} ${time}`;
    pushAll({ title: `⏰ ${alarm.label}`, body: `${time} 예약 알람입니다.`, tag: `alarm-${alarm.id}`, url: '/' })
      .catch((e) => console.error('scheduled alarm', e));
  }
  save();
}

setInterval(checkScheduledAlarms, 15000);

// ---- 대시보드 데이터 ----
app.get('/api/feed', (_req, res) => {
  const db = get();
  const today = new Date().toISOString().slice(0, 10);
  const todays = db.captures.filter((c) => c.ts.slice(0, 10) === today);
  const bySource = {};
  const byCategory = {};
  for (const c of todays) {
    bySource[c.source] = (bySource[c.source] || 0) + 1;
    byCategory[c.category || '일반'] = (byCategory[c.category || '일반'] || 0) + 1;
  }
  res.json({
    captures: db.captures.slice(0, 100),
    counts: { total: todays.length, urgent: todays.filter((c) => c.urgent).length, bySource, byCategory },
    rules: db.rules,
    settings: db.settings,
    subscriptionsCount: db.subscriptions.length
  });
});

// ---- 규칙/설정 수정 ----
app.post('/api/rules', (req, res) => {
  const db = get();
  if (Array.isArray(req.body.rules)) db.rules = req.body.rules
    .filter((r) => r && r.keyword)
    .map((r) => ({ id: r.id || uid(), keyword: String(r.keyword).slice(0, 40), category: String(r.category || '일반').trim().slice(0, 30) || '일반', urgent: !!r.urgent }));
  save();
  res.json({ ok: true, rules: db.rules });
});
app.post('/api/settings', (req, res) => {
  const db = get();
  if (typeof req.body.muteAll === 'boolean') db.settings.muteAll = req.body.muteAll;
  if (typeof req.body.alarmSound === 'boolean') db.settings.alarmSound = req.body.alarmSound;
  if (typeof req.body.alarmVibrate === 'boolean') db.settings.alarmVibrate = req.body.alarmVibrate;
  save();
  res.json({ ok: true, settings: db.settings });
});

// ---- 브리핑: 캡처 + 이메일 + AI 요약 (설정 없으면 규칙 기반으로 자동 대체) ----
app.get('/api/brief', async (req, res) => {
  try {
    const when = req.query.when === 'evening' ? 'evening' : 'morning';
    const brief = await buildBrief(get().captures, when);
    res.json(brief);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tasks', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim().slice(0, 300);
    res.json(await answerTasks(get().captures, question));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 브리핑 생성 + 폰으로 즉시 푸시 ----
async function runBriefAndPush(when) {
  const brief = await buildBrief(get().captures, when);
  const head = when === 'evening' ? '🌆 퇴근 전 브리핑' : '☀️ 출근 브리핑';
  const body = brief.action_items && brief.action_items.length
    ? brief.action_items.slice(0, 4).map((t) => '• ' + t).join('\n')
    : brief.summary;
  await pushAll({ title: head, body: body.slice(0, 300), url: '/' });
  return brief;
}
app.post('/api/brief/run', async (req, res) => {
  try {
    const when = req.body && req.body.when === 'evening' ? 'evening' : 'morning';
    const brief = await runBriefAndPush(when);
    res.json({ ok: true, brief });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 자동 스케줄: 출근/퇴근 브리핑 (Asia/Seoul) ----
const TZ = process.env.TZ || 'Asia/Seoul';
const MORNING = process.env.CRON_MORNING || '0 8 * * 1-5';    // 평일 08:00
const EVENING = process.env.CRON_EVENING || '30 18 * * 1-5';  // 평일 18:30
cron.schedule(MORNING, () => runBriefAndPush('morning').catch((e) => console.error('morning brief', e)), { timezone: TZ });
cron.schedule(EVENING, () => runBriefAndPush('evening').catch((e) => console.error('evening brief', e)), { timezone: TZ });

app.listen(PORT, () => console.log(`AMR 알람 서버 실행 중: http://localhost:${PORT} (브리핑 ${MORNING} / ${EVENING} ${TZ})`));
