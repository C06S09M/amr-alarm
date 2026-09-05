// 통화 녹음(오디오)을 텍스트로 전사. OpenAI Whisper(whisper-1) 사용 — 한국어 지원 우수.
// OPENAI_API_KEY 가 없으면 전사를 건너뛰고 null 을 돌려줍니다(앱은 계속 동작).
const STT_MODEL = process.env.STT_MODEL || 'whisper-1';

export async function transcribeAudio(buffer, filename = 'call.m4a') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { enabled: false, text: null };
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    form.append('model', STT_MODEL);
    form.append('language', 'ko');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form
    });
    if (!res.ok) throw new Error('STT ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    return { enabled: true, text: (data.text || '').trim() };
  } catch (e) {
    console.error('[transcribe] 실패:', e.message);
    return { enabled: true, error: e.message, text: null };
  }
}
