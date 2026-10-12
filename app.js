(() => {
  'use strict';
  const KST = 'Asia/Seoul';
  const $ = (id) => document.getElementById(id);
  const state = { feed: window.KIDS_INITIAL_DATA || { mode: 'preview', items: [], newIds: [] }, tab: 'news', search: '', area: 'all', topic: 'all', sort: 'smart', options: { free: false, weekend: false, exact: false, upcoming: true }, limit: 12, saved: new Set() };
  try { state.saved = new Set(JSON.parse(localStorage.getItem('seoul-kids-saved-v1') || '[]')); } catch (_e) {}

  const escapeHTML = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dateFrom = (s) => {
    if (!s) return null;
    const text = String(s).trim().replace(/\./g, '-').replace(' ', 'T');
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+09:00` : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:\d{2})$/.test(text) ? `${text}+09:00` : text;
    const value = new Date(iso);
    return Number.isFinite(value.getTime()) ? value : null;
  };
  const fmt = (s, includeClock = false) => {
    const d = dateFrom(s);
    if (!d) return '일정 확인';
    return new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric', ...(includeClock ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(d).replace(/\.$/, '');
  };
  const ymd = (d) => new Intl.DateTimeFormat('ko-KR', { timeZone: KST, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(d);
  const differenceDays = (date, now) => date ? (date.getTime() - now.getTime()) / 86400000 : Infinity;
  const actualStatus = (item, now = new Date()) => {
    const start = dateFrom(item.receiptStart), end = dateFrom(item.receiptEnd);
    const status = item.status || '';
    if (end && end < now) return 'closed';
    if (status.includes('마감') || status.includes('종료') || status.includes('취소')) return 'closed';
    if (start && start > now) return 'upcoming';
    if (status.includes('접수중') || status.includes('예약중')) return end && differenceDays(end, now) <= 3 ? 'closing' : 'open';
    return 'unknown';
  };
  const statuses = {open: ['접수 중', 'open'], closing: ['마감 임박', 'closing'], upcoming: ['접수 예정', 'upcoming'], closed: ['접수 마감', 'closed'], unknown: ['원문 확인', 'closed']};
  const topics = {'과학·기술':'🔬','역사·박물관':'🏛️','예술·만들기':'🎨','자연·생태':'🌿','기타 교육·체험':'✦'};
  const isWeekend = (item) => {
    let start = dateFrom(item.eventStart), end = dateFrom(item.eventEnd);
    if (!start) return false;
    if (!end || end < start) end = start;
    const duration = Math.min(7, Math.max(0, Math.ceil((end - start) / 86400000)));
    for (let i = 0; i <= duration; i++) { const d = new Date(start.getTime() + i * 86400000); const weekday = new Intl.DateTimeFormat('en-US', {timeZone: KST, weekday: 'short'}).format(d); if (weekday === 'Sat' || weekday === 'Sun') return true; }
    return false;
  };
  const isNew = (item) => (state.feed.newIds || []).includes(item.id);
  const score = (item, now) => {
    const status = actualStatus(item, now);
    let n = item.eligibility === 'confirmed' ? 12 : 1;
    if (isNew(item)) n += 90;
    if (status === 'closing') n += 70;
    if (status === 'open') n += 55;
    if (status === 'upcoming') n += 35;
    if (isWeekend(item)) n += 6;
    if (item.pay && String(item.pay).includes('무료')) n += 3;
    return n;
  };
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2500); }
  function updateAreaOptions() {
    const selected = $('areaFilter').value;
    const areas = [...new Set((state.feed.items || []).map((x) => x.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('areaFilter').innerHTML = '<option value="all">서울 전체 지역</option>' + areas.map((a) => `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`).join('');
    if (areas.includes(selected)) $('areaFilter').value = selected;
  }
  function filtered() {
    const now = new Date();
    const query = state.search.trim().toLowerCase();
    const list = (state.feed.items || []).filter((x) => {
      const status = actualStatus(x, now);
      if (state.tab === 'saved') { if (!state.saved.has(x.id)) return false; }
      else if (status === 'closed') return false;
      if (state.tab === 'news' && status === 'unknown') return false;
      if (!state.options.upcoming && status === 'upcoming') return false;
      if (state.area !== 'all' && state.area !== x.area) return false;
      if (state.topic !== 'all' && state.topic !== x.topic) return false;
      if (state.options.free && !(x.pay || '').includes('무료')) return false;
      if (state.options.exact && x.eligibility !== 'confirmed') return false;
      if (state.options.weekend && !isWeekend(x)) return false;
      if (query && ![x.title, x.area, x.place, x.target, x.topic, x.subcategory].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (state.sort === 'closing') return (dateFrom(a.receiptEnd)?.getTime() || Infinity) - (dateFrom(b.receiptEnd)?.getTime() || Infinity);
      if (state.sort === 'recent') return (dateFrom(b.receiptStart)?.getTime() || 0) - (dateFrom(a.receiptStart)?.getTime() || 0);
      if (state.sort === 'event') return (dateFrom(a.eventStart)?.getTime() || Infinity) - (dateFrom(b.eventStart)?.getTime() || Infinity);
      return score(b, now) - score(a, now) || (dateFrom(a.receiptEnd)?.getTime() || Infinity) - (dateFrom(b.receiptEnd)?.getTime() || Infinity);
    });
    return list;
  }
  function cardHTML(item) {
    const stat = actualStatus(item), status = statuses[stat];
    const newTag = isNew(item) ? '<span class="tag feature">NEW · 신규 수집</span>' : '';
    const eligible = item.eligibility === 'confirmed' ? '고학년 대상 명시' : '대상 학년 원문 확인';
    const saved = state.saved.has(item.id);
    const serviceUrl = /^S\d+$/.test(String(item.id)) ? `https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=${encodeURIComponent(item.id)}` : 'https://yeyak.seoul.go.kr/web/main.do';
    const dates = `${fmt(item.eventStart)}${item.eventEnd && item.eventStart !== item.eventEnd ? ' ~ ' + fmt(item.eventEnd) : ''}`;
    const deadline = stat === 'upcoming' ? `접수 시작 ${fmt(item.receiptStart, true)}` : item.receiptEnd ? `~ ${fmt(item.receiptEnd, true)}` : '원문 확인';
    const topic = topics[item.topic] ? item.topic : '기타 교육·체험';
    return `<article class="news-card"><div class="card-top"><span class="topic"><span class="topic-icon">${topics[topic]}</span>${escapeHTML(topic)}</span><span class="status ${status[1]}">${status[0]}</span></div><div class="card-tags">${newTag}<span class="tag">${escapeHTML(item.category || '문화·교육')}</span><span class="tag">${escapeHTML(item.area || '서울')}</span><span class="tag">${escapeHTML(item.pay || '비용 확인')}</span></div><h3>${escapeHTML(item.title)}</h3><p class="target-note">${escapeHTML(eligible)} · ${escapeHTML(item.target || '상세 대상 확인 필요')}</p><div class="card-info"><div class="info-line"><span>장소</span><strong>${escapeHTML(item.place || item.area || '원문 확인')}</strong></div><div class="info-line"><span>체험일</span><strong>${escapeHTML(dates)}</strong></div><div class="info-line"><span>접수</span><strong>${escapeHTML(deadline)}</strong></div></div><div class="card-footer"><button class="save-btn ${saved ? 'saved' : ''}" type="button" data-save="${escapeHTML(item.id)}" aria-label="${saved ? '관심 목록에서 해제' : '관심 목록에 저장'}"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" fill="${saved ? 'currentColor' : 'none'}" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.7a5.6 5.6 0 0 0-7.9 0L12 5.6l-.9-.9a5.6 5.6 0 0 0-7.9 7.9l.9.9L12 21l7.9-7.9.9-.9a5.6 5.6 0 0 0 0-7.9z"/></svg>${saved ? '저장됨' : '관심 저장'}</button><a class="go-btn" href="${serviceUrl}" target="_blank" rel="noopener noreferrer">예약 정보 보기 ↗</a></div></article>`;
  }
  function render() {
    const all = state.feed.items || [], now = new Date();
    const active = all.filter((x) => actualStatus(x, now) !== 'closed');
    $('totalCount').textContent = active.length.toLocaleString('ko-KR');
    $('openCount').textContent = active.filter((x) => ['open', 'closing'].includes(actualStatus(x, now))).length.toLocaleString('ko-KR');
    $('closingCount').textContent = active.filter((x) => actualStatus(x, now) === 'closing').length.toLocaleString('ko-KR');
    $('savedNum').textContent = state.saved.size ? `${state.saved.size}` : '';
    document.querySelectorAll('.tab').forEach((tab) => { const activeTab = tab.dataset.tab === state.tab; tab.classList.toggle('active', activeTab); if (activeTab) tab.setAttribute('aria-current','page'); else tab.removeAttribute('aria-current'); });
    document.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', state.options[chip.dataset.filter] ? 'true' : 'false'));
    const headers = {news:['오늘 눈여겨볼 프로그램','모집 중이거나 곧 접수하는 소식부터 골랐어요.'],browse:['서울의 문화·교육 프로그램','관심 주제와 동네별로 찾아보세요.'],saved:['우리 가족 관심 목록','저장은 기기별로 보관돼요. 부부가 공유하려면 예약 링크를 보내주세요.']};
    $('sectionTitle').textContent = headers[state.tab][0]; $('sectionDescription').textContent = headers[state.tab][1];
    const list = filtered();
    $('countText').textContent = `${list.length}개 소식`;
    $('resultsLabel').textContent = `조건에 맞는 프로그램 ${list.length}개`;
    const shown = list.slice(0, state.limit);
    $('cards').innerHTML = shown.length ? shown.map(cardHTML).join('') : `<div class="empty"><strong>${state.tab === 'saved' ? '아직 저장한 소식이 없어요' : '조건에 맞는 소식이 없습니다'}</strong>${['preview','curated'].includes(state.feed.mode) ? '현재는 일부 수동 확인 공고만 들어 있습니다. API 설정 후 전체 소식이 표시돼요.' : '지역이나 관심 분야를 바꿔서 다시 찾아보세요.'}</div>`;
    $('moreHolder').innerHTML = list.length > shown.length ? `<button type="button" class="more-btn" id="moreBtn">더 보기 (${list.length - shown.length}개 남음)</button>` : '';
    $('moreBtn')?.addEventListener('click', () => { state.limit += 16; render(); });
    $('cards').querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', () => { const id = btn.dataset.save; if (state.saved.has(id)) { state.saved.delete(id); toast('관심 목록에서 제외했습니다'); } else { state.saved.add(id); toast('관심 목록에 저장했습니다'); } try { localStorage.setItem('seoul-kids-saved-v1', JSON.stringify([...state.saved])); } catch (_e) {} render(); }));
  }
  function metadata() {
    const feed = state.feed;
    if (feed.mode === 'preview' || feed.mode === 'curated') {
      $('updateLabel').textContent = feed.mode === 'curated' ? '직접 확인한 일부 공고 · 실시간 아님' : '초기 미리보기 · 자동 갱신 설정 전';
      $('sourceAlert').textContent = feed.notice || '미리보기 모드입니다. 공식 API 키와 자동 갱신을 설정해야 합니다.';
      $('sourceAlert').hidden = false;
      return;
    }
    const parsed = dateFrom(feed.lastSuccess || feed.capturedAt);
    $('updateLabel').textContent = parsed ? `${ymd(parsed)} 갱신` : '최근 데이터 갱신 시각 확인 필요';
    if (parsed && Date.now() - parsed.getTime() > 48 * 3600000) {
      $('sourceAlert').textContent = '마지막 정상 갱신으로부터 48시간 이상 경과했습니다. 최신 접수 상태는 서울시 원문에서 확인하세요.';
      $('sourceAlert').hidden = false;
    } else { $('sourceAlert').hidden = true; }
  }
  // If today's successful morning collection is absent, ask the SAME-ORIGIN backend
  // for one refresh when opening. GitHub Pages alone cannot run this endpoint;
  // the included Vercel Python function does. An installed API key remains server-side.
  function kstDay(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  }
  function morningSlot(now = new Date()) {
    const hhmm = new Intl.DateTimeFormat('en-GB', {timeZone: KST,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
    return hhmm >= '09:15' ? 'morning' : 'early';
  }
  function needsRefresh(feed) {
    const d = dateFrom(feed?.lastSuccess);
    if (!(feed?.mode === 'live' && Array.isArray(feed?.items) && feed.items.length && d && kstDay(d) === kstDay())) return true;
    return morningSlot() === 'morning' && morningSlot(d) !== 'morning';
  }
  async function requestCurrentFeed() {
    const response = await fetch('./api/events?slot=' + morningSlot(), {cache:'no-store'});
    if (!response.ok) throw new Error('서버 HTTP ' + response.status);
    const data = await response.json();
    if (!data || data.mode !== 'live' || !Array.isArray(data.items)) throw new Error('응답 자료 오류');
    state.feed = data;
    metadata(); updateAreaOptions(); render();
    return data;
  }
  async function fetchFeed(manual = false) {
    const btn = $('refreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
    let updated = false;
    if (location.protocol !== 'file:') {
      try {
        const response = await fetch('./data/events.json?_=' + Date.now(), {cache:'no-store'});
        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data.items) && (data.items.length || !state.feed.items?.length)) state.feed = data;
        }
      } catch (err) { console.info('내장 공고 목록으로 표시합니다:',err); }
    }
    if (location.protocol !== 'file:' && (manual || needsRefresh(state.feed))) {
      try {
        await requestCurrentFeed();
        updated = true;
      } catch (err) {
        console.info('접속 시 갱신을 지원하는 서버가 아직 연결되지 않았습니다:',err);
      }
    }
    metadata(); updateAreaOptions(); render();
    if (btn) { btn.disabled = false; btn.textContent = '최신 자료 확인 ↻'; }
    if (manual) toast(updated ? '최신 API 조회가 완료되었습니다' : '새 자료를 가져오지 못했습니다. API 연결을 확인하세요.');
  }
  async function share() {
    if (location.protocol === 'file:') { toast('웹사이트로 게시한 뒤 주소를 공유할 수 있어요'); return; }
    const url = new URL('./index.html', location.href).href;
    try {
      if (navigator.share) await navigator.share({title:'서울 키즈 클래스 뉴스',text:'초등 4~6학년 서울 문화체험·교육강좌 예약 소식',url});
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); toast('웹앱 주소를 복사했습니다'); }
      else window.prompt('이 주소를 카카오톡으로 보내세요',url);
    } catch (err) { if (err.name !== 'AbortError') toast('공유에 실패했습니다. 주소창 링크를 복사해주세요'); }
  }
  function resetFilters() {
    state.search='';state.area='all';state.topic='all';state.sort='smart';state.options={free:false,weekend:false,exact:false,upcoming:true};state.limit=12;
    $('searchInput').value='';$('areaFilter').value='all';$('topicFilter').value='all';$('sortFilter').value='smart';render();
  }
  document.querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => { state.tab=el.dataset.tab;state.limit=12; render(); }));
  document.querySelectorAll('.chip').forEach((el) => el.addEventListener('click', () => { state.options[el.dataset.filter] = !state.options[el.dataset.filter];state.limit=12;render(); }));
  $('searchInput').addEventListener('input', (e) => { state.search=e.target.value;state.limit=12;render(); });
  $('areaFilter').addEventListener('change', (e) => { state.area=e.target.value;state.limit=12;render(); });
  $('topicFilter').addEventListener('change', (e) => { state.topic=e.target.value;state.limit=12;render(); });
  $('sortFilter').addEventListener('change', (e) => { state.sort=e.target.value;state.limit=12;render(); });
  $('clearBtn').addEventListener('click',resetFilters);$('shareBtn').addEventListener('click',share);$('refreshBtn')?.addEventListener('click',()=>fetchFeed(true));
  $('todayLabel').textContent = ymd(new Date());
  fetchFeed();
})();
