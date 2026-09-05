// 아주 단순한 JSON 파일 저장소 (외부 DB 없이 동작).
// 무료 호스팅(Render 등)은 디스크가 재배포 시 초기화될 수 있으니,
// 영구 보관이 필요하면 README의 'DB 업그레이드' 항목 참고.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT = {
  captures: [],       // {id, ts, source, sender, title, text, type, urgent}
  subscriptions: [],  // web-push 구독 객체
  alarms: [],         // {id, time, label, days, enabled, lastFired}
  contacts: [],       // {id, sender, company, name, department}
  completedTasks: [], // 업무 정리 결과에서 완료 처리한 항목 문자열
  rules: [            // 기본 키워드 규칙 (대시보드에서 수정)
    { id: 'r1', keyword: '견적', category: '영업', urgent: true },
    { id: 'r2', keyword: '발주', category: '구매', urgent: true },
    { id: 'r3', keyword: 'PO', category: '구매', urgent: true },
    { id: 'r4', keyword: '납기', category: '일정', urgent: true }
  ],
  settings: { muteAll: false, alarmSound: true, alarmVibrate: true }
};

let db;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULT, null, 2));
}

export function load() {
  ensure();
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    db = structuredClone(DEFAULT);
  }
  // 누락 필드 보정
  for (const k of Object.keys(DEFAULT)) if (db[k] === undefined) db[k] = structuredClone(DEFAULT[k]);
  for (const k of Object.keys(DEFAULT.settings)) if (db.settings[k] === undefined) db.settings[k] = DEFAULT.settings[k];
  db.rules = db.rules.map((rule) => ({ ...rule, category: rule.category || '일반' }));
  db.captures = db.captures.map((capture) => ({ ...capture, category: capture.category || '일반' }));
  return db;
}

let saveTimer = null;
export function save() {
  if (saveTimer) return;              // 디스크 쓰기 디바운스 (0.5초)
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error('save 실패', e); }
  }, 500);
}

export function get() { return db; }
