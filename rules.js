// 캡처 1건을 규칙에 대입해 '긴급 여부'와 매칭된 키워드를 판정.
export function evaluate(capture, rules) {
  const hay = `${capture.title || ''} ${capture.text || ''} ${capture.sender || ''}`.toLowerCase();
  const matched = [];
  const categories = [];
  let urgent = false;
  for (const r of rules || []) {
    const kw = (r.keyword || '').trim().toLowerCase();
    if (!kw) continue;
    if (hay.includes(kw)) {
      matched.push(r.keyword);
      categories.push(r.category || '일반');
      if (r.urgent) urgent = true;
    }
  }
  return { urgent, matched, categories: [...new Set(categories)] };
}

// 광고성 알림(알림톡 광고, 스팸 문자) 판별.
// 한국 광고 메시지는 보통 "(광고)"로 시작하고 "무료수신거부" 문구가 붙는다.
export const DEFAULT_AD_PATTERNS = [
  '(광고)', '[광고]', '광고)', '무료수신거부', '무료 수신거부', '수신거부', '수신 거부', '광고성 정보'
];

export function isAd(capture, keywords) {
  const hay = `${capture.title || ''} ${capture.text || ''} ${capture.sender || ''}`.toLowerCase();
  const list = Array.isArray(keywords) && keywords.length ? keywords : DEFAULT_AD_PATTERNS;
  return list.some((k) => {
    const kw = String(k || '').trim().toLowerCase();
    return kw && hay.includes(kw);
  });
}
