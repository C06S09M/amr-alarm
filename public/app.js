const $ = (s) => document.querySelector(s);
const api = (p, opt) => fetch(p, opt).then(async (r) => {
  const data = await r.json();
  if (r.status === 401 && data.error === 'login_required') location.assign('/login.html');
  return data;
});
let state = { filter: 'all', rules: [], alarms: [], muted: false, vapid: null };

// ---- 서비스워커 등록 ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW 등록 실패', e));
}

function b64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ---- 알림 켜기(구독) ----
async function enableNotifications() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('이 브라우저는 웹푸시를 지원하지 않습니다.'); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setStatus('알림 권한이 거부되었습니다.'); return; }
    const reg = await navigator.serviceWorker.ready;
    if (!state.vapid) { const c = await api('/api/config'); state.vapid = c.vapidPublicKey; }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(state.vapid)
    });
    await api('/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
    $('#enableBtn').textContent = '알림 켜짐 ✓';
    $('#enableBtn').disabled = true;
    setStatus('이 기기로 알람을 받습니다.');
    loadFeed();
  } catch (e) { setStatus('구독 실패: ' + e.message); }
}

function setStatus(t) { $('#status').textContent = t; }
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const esc = (s) => (s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ---- 피드 렌더 ----
function renderFeed(caps) {
  const list = $('#feed');
  const filtered = state.filter === 'all' ? caps : state.filter.startsWith('category:')
    ? caps.filter((c) => (c.category || '일반') === state.filter.slice(9))
    : caps.filter((c) => c.source === state.filter);
  $('#feedEmpty').hidden = filtered.length > 0;
  list.innerHTML = filtered.map((c) => `
    <li class="${c.urgent ? 'urgent' : ''}">
      <div class="row1">
        <span class="src">${esc(c.source)}</span>
        <span class="time">${fmtTime(c.ts)}</span>
      </div>
      <div class="msg">${c.sender ? `<span class="who">${esc(c.sender)}</span>` : ''}${esc(c.title || c.text)}</div>
      <div class="capture-category">${esc(c.category || '일반')}</div>
      ${c.matched && c.matched.length ? `<div class="tags">${c.matched.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>` : ''}
    </li>`).join('');
}

function renderFilters(bySource, byCategory) {
  const sources = ['all', ...Object.keys(bySource || {})];
  const categories = Object.keys(byCategory || {}).map((category) => `category:${category}`);
  const filters = [...sources, ...categories];
  $('#filters').innerHTML = filters.map((s) =>
    `<button class="chip ${state.filter === s ? 'on' : ''}" data-s="${esc(s)}">${s === 'all' ? '전체' : s.startsWith('category:') ? `분류 · ${esc(s.slice(9))}` : esc(s)}</button>`).join('');
  $('#filters').querySelectorAll('.chip').forEach((b) =>
    b.onclick = () => { state.filter = b.dataset.s; loadFeed(); });
}

function renderRules() {
  $('#rules').innerHTML = state.rules.map((r, i) => `
    <li data-i="${i}">
      <input type="text" value="${esc(r.keyword)}" data-k="keyword" placeholder="키워드" />
      <input class="rule-category" type="text" value="${esc(r.category || '일반')}" data-k="category" placeholder="분류" maxlength="30" />
      <label><input type="checkbox" data-k="urgent" ${r.urgent ? 'checked' : ''}/> 긴급</label>
      <button class="del" title="삭제">×</button>
    </li>`).join('');
  $('#rules').querySelectorAll('li').forEach((li) => {
    const i = +li.dataset.i;
    li.querySelector('[data-k=keyword]').oninput = (e) => state.rules[i].keyword = e.target.value;
    li.querySelector('[data-k=category]').oninput = (e) => state.rules[i].category = e.target.value;
    li.querySelector('[data-k=urgent]').onchange = (e) => state.rules[i].urgent = e.target.checked;
    li.querySelector('.del').onclick = () => { state.rules.splice(i, 1); renderRules(); };
  });
}

async function loadFeed() {
  const d = await api('/api/feed');
  $('#cTotal').textContent = d.counts.total;
  $('#cUrgent').textContent = d.counts.urgent;
  $('#cDevices').textContent = d.subscriptionsCount != null ? d.subscriptionsCount : '-';
  state.rules = d.rules; state.muted = d.settings.muteAll;
  $('#soundToggle').checked = d.settings.alarmSound !== false;
  $('#vibrateToggle').checked = d.settings.alarmVibrate !== false;
  $('#muteBtn').classList.toggle('muted-on', state.muted);
  $('#muteBtn').textContent = state.muted ? '🔕' : '🔔';
  renderFilters(d.counts.bySource, d.counts.byCategory);
  renderFeed(d.captures);
  renderRules();
}

async function loadBrief() {
  const b = await api('/api/brief');
  $('#briefSummary').textContent = b.summary;
  $('#briefList').innerHTML = (b.action_items || []).map((t) => `<li>${esc(t)}</li>`).join('')
    || '<li class="muted">긴급 항목 없음</li>';
}

async function askTasks(question = '') {
  $('#taskSummary').textContent = '최근 통화·카톡·문자를 정리하는 중…';
  const result = await api('/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });
  $('#taskSummary').textContent = result.summary || '';
  $('#taskList').innerHTML = (result.action_items || []).map((item) => `<li class="task-item"><span>${esc(item)}</span><button class="task-done" data-task="${esc(item)}">완료</button></li>`).join('')
    || '<li class="muted">정리할 업무가 없습니다.</li>';
  $('#taskList').querySelectorAll('[data-task]').forEach((button) => {
    button.onclick = async () => {
      await api('/api/tasks/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: button.dataset.task })
      });
      askTasks($('#taskQuestion').value);
    };
  });
}

const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
function renderAlarms() {
  const list = $('#alarms');
  $('#alarmEmpty').hidden = state.alarms.length > 0;
  list.innerHTML = state.alarms.map((alarm) => `
    <li class="alarm-item ${alarm.enabled ? '' : 'disabled'}">
      <label class="alarm-toggle"><input type="checkbox" data-toggle="${alarm.id}" ${alarm.enabled ? 'checked' : ''} /><span></span></label>
      <div class="alarm-info"><strong>${esc(alarm.time)}</strong><span>${esc(alarm.label)}</span><small>${alarm.days.map((day) => dayNames[day]).join(' · ')}</small></div>
      <button class="del" data-delete="${alarm.id}" title="삭제" aria-label="${esc(alarm.label)} 삭제">×</button>
    </li>`).join('');
  list.querySelectorAll('[data-toggle]').forEach((input) => {
    input.onchange = async () => {
      await api(`/api/alarms/${input.dataset.toggle}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: input.checked })
      });
      loadAlarms();
    };
  });
  list.querySelectorAll('[data-delete]').forEach((button) => {
    button.onclick = async () => {
      await api(`/api/alarms/${button.dataset.delete}`, { method: 'DELETE' });
      loadAlarms();
    };
  });
}

async function loadAlarms() {
  const d = await api('/api/alarms');
  state.alarms = d.alarms || [];
  renderAlarms();
}

function renderContacts(contacts) {
  $('#contacts').innerHTML = contacts.map((contact) => `
    <li class="contact-item">
      <div><strong>${esc(contact.company || '업체 미지정')}</strong><span>${esc(contact.name || contact.sender)}</span><small>${esc(contact.department || '')} · ${esc(contact.sender)}</small></div>
      <button class="del" data-contact-delete="${contact.id}" title="삭제">×</button>
    </li>`).join('');
  $('#contacts').querySelectorAll('[data-contact-delete]').forEach((button) => {
    button.onclick = async () => { await api(`/api/contacts/${button.dataset.contactDelete}`, { method: 'DELETE' }); loadContacts(); };
  });
}

async function loadContacts() {
  const data = await api('/api/contacts');
  renderContacts(data.contacts || []);
}

// ---- 이벤트 바인딩 ----
$('#enableBtn').onclick = enableNotifications;
$('#refreshBrief').onclick = loadBrief;
$('#taskForm').onsubmit = async (e) => { e.preventDefault(); askTasks($('#taskQuestion').value); };
$('#resetTasks').onclick = async () => {
  await api('/api/tasks/reset', { method: 'POST' });
  askTasks($('#taskQuestion').value);
  setStatus('완료 업무를 초기화했습니다.');
};
$('#testBtn').onclick = async () => { const r = await api('/api/test-push', { method: 'POST' }); setStatus(`테스트 알람 발송(${r.sent}대 기기).`); };
$('#muteBtn').onclick = async () => {
  const r = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muteAll: !state.muted }) });
  state.muted = r.settings.muteAll; loadFeed();
};
async function saveNotificationSetting(key, value) {
  await api('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value })
  });
  setStatus('알림 설정을 저장했습니다.');
}
$('#soundToggle').onchange = (e) => saveNotificationSetting('alarmSound', e.target.checked);
$('#vibrateToggle').onchange = (e) => saveNotificationSetting('alarmVibrate', e.target.checked);
$('#addRule').onclick = () => { state.rules.push({ keyword: '', category: '일반', urgent: true }); renderRules(); };
$('#saveRules').onclick = async () => {
  const r = await api('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: state.rules }) });
  state.rules = r.rules; renderRules(); setStatus('규칙을 저장했습니다.');
};
$('#contactForm').onsubmit = async (e) => {
  e.preventDefault();
  const result = await api('/api/contacts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: $('#contactSender').value, company: $('#contactCompany').value, name: $('#contactName').value, department: $('#contactDepartment').value })
  });
  if (result.error) { setStatus(result.error); return; }
  e.target.reset(); loadContacts(); setStatus('거래처 정보를 저장했습니다.');
};
$('#copyUrl').onclick = () => { navigator.clipboard.writeText($('#ingestUrl').textContent).then(() => setStatus('주소를 복사했습니다.')); };
document.querySelectorAll('.copy-macro').forEach((button) => {
  button.onclick = () => navigator.clipboard.writeText($('#' + button.dataset.copyTarget).textContent)
    .then(() => setStatus('MacroDroid 설정값을 복사했습니다.'));
});
$('#alarmForm').onsubmit = async (e) => {
  e.preventDefault();
  const days = [...document.querySelectorAll('input[name=alarmDay]:checked')].map((input) => Number(input.value));
  if (!days.length) { setStatus('반복 요일을 하나 이상 선택하세요.'); return; }
  const r = await api('/api/alarms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time: $('#alarmTime').value, label: $('#alarmLabel').value, days })
  });
  if (r.error) { setStatus(r.error); return; }
  $('#alarmLabel').value = '';
  setStatus('예약 알람을 추가했습니다.');
  loadAlarms();
};

// 초기화
$('#ingestUrl').textContent = `${location.origin}/api/ingest?token=<발급토큰>`;
loadFeed(); loadBrief();
loadAlarms();
loadContacts();
setInterval(loadFeed, 20000);   // 20초마다 피드 갱신
