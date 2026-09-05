// Gmail을 IMAP + 앱 비밀번호로 읽습니다 (구글 OAuth 설정 없이 개인용으로 가장 간단).
// 필요: 구글 계정 2단계 인증 → 앱 비밀번호 생성 → GMAIL_USER / GMAIL_APP_PASSWORD 환경변수.
// 설정이 없으면 빈 배열을 돌려주고 조용히 넘어갑니다(브리핑은 캡처만으로도 동작).
import { ImapFlow } from 'imapflow';

export async function fetchRecentEmails({ hours = 16, max = 20 } = {}) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { enabled: false, emails: [] };

  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass }, logger: false
  });
  const emails = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - hours * 3600 * 1000);
      const uids = await client.search({ since }, { uid: true });
      const pick = (uids || []).slice(-max);
      for await (const msg of client.fetch(
        { uid: pick.length ? pick : '1:1' },
        { envelope: true, bodyStructure: false, internalDate: true }
      )) {
        if (!pick.length) break;
        const env = msg.envelope || {};
        const from = (env.from && env.from[0]) ? (env.from[0].name || env.from[0].address) : '';
        emails.push({
          from,
          subject: env.subject || '(제목 없음)',
          date: (msg.internalDate || env.date || new Date()).toISOString()
        });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    console.error('[email] 읽기 실패:', e.message);
    try { await client.close(); } catch {}
    return { enabled: true, error: e.message, emails: [] };
  }
  emails.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { enabled: true, emails };
}
