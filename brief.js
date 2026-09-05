// 브리핑 생성: 캡처 + 이메일을 모아 "오늘 해야 할 것"을 정리.
// ANTHROPIC_API_KEY 가 있으면 Claude API로 지능적 요약, 없으면 규칙 기반 요약으로 자동 대체.
import { fetchRecentEmails } from './email.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';

function ruleBased(captures, emails) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = captures.filter((c) => c.ts.slice(0, 10) === today);
  const urgent = todays.filter((c) => c.urgent);
  const items = urgent.slice(0, 10).map((c) =>
    `[${c.source}] ${c.sender || ''} ${c.title || c.text}`.trim());
  for (const e of emails.slice(0, 6)) items.push(`[메일] ${e.from}: ${e.subject}`);
  return {
    summary: `오늘 캡처 ${todays.length}건(긴급 ${urgent.length}건)` +
             (emails.length ? `, 최근 메일 ${emails.length}건.` : '.'),
    action_items: items,
    ai: false
  };
}

async function callClaude(captures, emails, when) {
  const key = process.env.ANTHROPIC_API_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const todays = captures.filter((c) => c.ts.slice(0, 10) === today);
  const capText = todays.map((c) =>
    `- (${c.source}) ${c.sender || ''}: ${c.title || c.text}${c.urgent ? ' [긴급]' : ''}`).join('\n') || '(없음)';
  const mailText = emails.map((e) => `- ${e.from}: ${e.subject}`).join('\n') || '(없음)';
  const label = when === 'evening' ? '퇴근 전 마감 브리핑' : '출근 브리핑';

  const prompt =
`당신은 AMR 영업 수석파트장의 업무 비서입니다. 아래는 오늘 폰으로 들어온 소통 기록과 최근 이메일입니다.
이걸 바탕으로 "${label}"을 만들어 주세요. 반드시 아래 JSON 형식으로만 답하세요.

[폰 캡처]
${capText}

[이메일]
${mailText}

요구사항:
- summary: 한두 문장으로 오늘 상황 요약(한국어, 존댓말).
- action_items: 실제로 "해야 할 행동" 목록. 각 항목은 동사로 끝나는 구체적 할 일(예: "MCNX 홍책임에게 견적 회신"). 우선순위 높은 순. 최대 8개.
- 잡담·광고·단순 안부는 제외. 회신·확인·결정이 필요한 것만.

JSON 형식: {"summary": "...", "action_items": ["...", "..."]}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error('Claude API ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : text);
  return {
    summary: parsed.summary || '',
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    ai: true
  };
}

// 통화 전사문에서 "상대가 요청/합의한 것"을 한 줄로 요약 (제목용).
// Claude 키가 없으면 앞부분을 잘라서 반환.
export async function summarizeCall(transcript) {
  const key = process.env.ANTHROPIC_API_KEY;
  const t = (transcript || '').trim();
  if (!t) return '';
  if (!key) return t.slice(0, 80);
  try {
    const prompt =
`아래는 영업 담당자의 통화 녹음 전사문입니다. 이 통화에서 '상대가 요청했거나 합의된 핵심 사항'만 한 문장으로 요약하세요(한국어, 명사형으로 간결하게, 25자 내외). 잡담은 무시.

전사문:
${t.slice(0, 4000)}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 120, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('Claude ' + res.status);
    const data = await res.json();
    return ((data.content && data.content[0] && data.content[0].text) || '').trim().slice(0, 120);
  } catch (e) {
    console.error('[summarizeCall] 실패:', e.message);
    return t.slice(0, 80);
  }
}

export async function buildBrief(captures, when = 'morning') {
  const { emails } = await fetchRecentEmails({ hours: when === 'evening' ? 12 : 16 });
  const date = new Date().toISOString().slice(0, 10);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const b = await callClaude(captures, emails, when);
      return { date, when, ...b };
    } catch (e) {
      console.error('[brief] Claude 실패, 규칙 기반으로 대체:', e.message);
    }
  }
  return { date, when, ...ruleBased(captures, emails) };
}

function recentCaptures(captures) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return captures.filter((capture) => Date.parse(capture.ts) >= since).slice(0, 200);
}

function fallbackTasks(captures, question) {
  const recent = recentCaptures(captures);
  const items = recent.map((capture) => {
    const text = `${capture.title || capture.text || ''}`.replace(/\s+/g, ' ').trim();
    const who = capture.sender ? `${capture.sender}에게 ` : '';
    const action = capture.urgent || capture.matched?.length ? '확인하고 회신하기' : '내용 확인하기';
    return `[${capture.source}] ${who}${text.slice(0, 140)} - ${action}`;
  });
  return {
    summary: question ? `'${question}' 관련 최근 업무 ${items.length}건입니다.` : `최근 7일 업무 ${items.length}건입니다.`,
    action_items: items.slice(0, 30),
    source_count: recent.length,
    ai: false
  };
}

export async function answerTasks(captures, question = '') {
  const recent = recentCaptures(captures);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackTasks(captures, question);
  const capText = recent.map((capture) =>
    `- (${capture.source}) ${capture.sender || ''}: ${capture.title || capture.text}${capture.urgent ? ' [긴급]' : ''}`).join('\n') || '(없음)';
  const prompt =
`당신은 업무 비서입니다. 아래는 최근 7일 동안 들어온 전화, 카카오톡, 문자 및 기타 소통 기록입니다.
사용자의 질문: ${question || '내가 해야 할 업무를 정리해줘'}

[소통 기록]
${capText}

실제로 사용자가 해야 할 회신, 확인, 준비, 결정 업무만 추려 JSON으로 답하세요.
잡담과 광고는 제외하고, 같은 업무는 합치세요. 최대 20개까지 우선순위 순으로 정리하세요.
JSON 형식: {"summary":"한두 문장 요약","action_items":["동사로 끝나는 구체적인 업무"]}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('Claude API ' + res.status);
    const data = await res.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    return { summary: parsed.summary || '', action_items: Array.isArray(parsed.action_items) ? parsed.action_items.slice(0, 20) : [], source_count: recent.length, ai: true };
  } catch (e) {
    console.error('[tasks] Claude 실패, 규칙 기반으로 대체:', e.message);
    return fallbackTasks(captures, question);
  }
}
