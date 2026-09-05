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
