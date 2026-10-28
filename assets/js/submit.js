/* =========================================================
   선생님께 제출하기
   - 학생이 고른 전시실의 글과 사진을 Apps Script 웹 앱(apps-script/Code.gs)으로 보낸다
   - 웹 앱이 도록 PDF를 만들어 선생님 드라이브에 학번_이름.pdf 로 저장한다
   - 학생은 구글에 로그인할 필요가 없다
   - 보낼 주소는 submit-config.js 의 MUSEUM_SUBMIT_URL

   기기 보관본
   - 제출을 누를 때마다 보낸 내용 전체를 기기의 IndexedDB에 학번_이름별로 보관한다
   - 작성 중인 내용(localStorage)과 달리 로그아웃·전시실 바꾸기로 지워지지 않으며,
     5MB 남짓한 localStorage 공간도 나눠 쓰지 않는다
   - 나중에 문제가 생기면 같은 학번·이름으로 들어와 ‘보관된 제출본 다시 보내기’로 다시 낸다
   ========================================================= */
(function () {
  'use strict';

  var buttons = document.querySelectorAll('[data-submit]');
  var api = window.MuseumCatalog;          // export-pdf.js 가 열어 둔 도구
  if (!buttons.length || !api) return;

  var ENDPOINT = String(window.MUSEUM_SUBMIT_URL || '').trim();
  var STORE = 'museum-submitted';          // 로그아웃하면 다른 museum-* 와 함께 지워진다
  var TIMEOUT = 90000;                     // PDF를 만드는 데 길게는 수십 초 걸린다
  var lastLines = document.querySelectorAll('[data-submit-last]');
  var resendButtons = document.querySelectorAll('[data-resubmit]');
  var allButtons = Array.prototype.slice.call(buttons).concat(Array.prototype.slice.call(resendButtons));
  var busy = false;

  /* =======================================================
     기기 보관함 (IndexedDB)
     — 이름에 museum- 을 붙이지 않는다: gate.js 로그아웃은 localStorage의
       museum-* 만 지우고, IndexedDB는 건드리지 않는다
     ======================================================= */
  var Archive = (function () {
    var DB = 'exhibit-archive';
    var OS = 'submissions';
    var opening = null;

    function open() {
      if (opening) return opening;
      opening = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no-idb')); return; }
        var req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(OS); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      opening['catch'](function () { opening = null; });   // 다음에 다시 열어 본다
      return opening;
    }

    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(OS, mode);
          var out = fn(t.objectStore(OS));
          t.oncomplete = function () { resolve(out && out.result); };
          t.onerror = t.onabort = function () { reject(t.error); };
        });
      });
    }

    return {
      get: function (key) { return tx('readonly', function (s) { return s.get(key); }); },
      put: function (key, rec) { return tx('readwrite', function (s) { s.put(rec, key); }); }
    };
  })();

  function keyOf(sid, name) { return sid + '_' + name; }

  function nowText() {
    var d = new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- 지난 제출 기록 (화면 표시용) ---------- */
  function readLast() {
    try {
      var raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeLast(rec) {
    try { localStorage.setItem(STORE, JSON.stringify(rec)); } catch (err) { /* 표시만 못 할 뿐 */ }
  }

  // 지금 입장한 학생의 기록일 때만 보여 준다
  function lastFor(v) {
    var rec = readLast();
    return (rec && v && rec.sid === v.sid && rec.name === v.name) ? rec : null;
  }

  // '2026-10-28 10:32:05' → '10월 28일 10:32'
  function when(at) {
    var m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(at || '');
    return m ? (+m[1]) + '월 ' + (+m[2]) + '일 ' + m[3] : (at || '');
  }

  function paintLast() {
    var v = api.visitor();
    var rec = lastFor(v);
    var msg = rec
      ? '✓ ' + when(rec.at) + '에 제출했습니다' +
        (rec.count > 1 ? ' (' + rec.count + '번째 제출 · 마지막 제출본만 남습니다)' : '')
      : '';

    function show(text, hasArchive) {
      Array.prototype.forEach.call(lastLines, function (el) { el.textContent = text; });
      Array.prototype.forEach.call(resendButtons, function (b) { b.hidden = !hasArchive; });
    }

    show(msg, false);
    if (!v) return;

    Archive.get(keyOf(v.sid, v.name)).then(function (box) {
      if (!box) return;
      var note = '기기 보관본: ' + when(box.savedAt) + ' 저장' +
                 (box.sentAt ? ' · ' + when(box.sentAt) + ' 제출됨' : ' · 아직 제출되지 않음');
      show(msg ? msg + ' / ' + note : note, true);
    })['catch'](function () { /* 보관함을 못 쓰는 기기에서는 버튼을 숨겨 둔다 */ });
  }

  /* ---------- 빠진 곳 찾기 ---------- */
  function missing(room) {
    var list = [];
    if (!room.reason.trim()) list.push('전시실을 선택한 이유');
    if (room.items.length < 3) list.push('자료 ' + (3 - room.items.length) + '점 더');
    room.items.forEach(function (it, i) {
      var gaps = [];
      if (!it.photo) gaps.push('사진');
      if (!(it.desc || '').trim()) gaps.push('자료 설명');
      if (!(it.event || '').trim()) gaps.push('역사적 배경과 의미');
      if (gaps.length) list.push('EXHIBIT 0' + (i + 1) + '의 ' + gaps.join('·'));
    });
    return list;
  }

  /* ---------- 버튼 상태 ---------- */
  function setBusy(on) {
    busy = on;
    allButtons.forEach(function (btn) {
      if (on) {
        btn.setAttribute('data-label', btn.textContent);
        btn.textContent = '제출하는 중…';
      } else if (btn.hasAttribute('data-label')) {
        btn.textContent = btn.getAttribute('data-label');
        btn.removeAttribute('data-label');
      }
      btn.disabled = on;
      btn.setAttribute('aria-busy', String(on));
    });
  }

  /* ---------- 보내기 ---------- */
  function send(payload, btn) {
    var key = keyOf(payload.sid, payload.name);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);

    setBusy(true);
    api.notify('제출하는 중입니다. 화면을 닫지 말고 잠시 기다려 주세요. (길게는 30초쯤 걸립니다)', false, null, btn);

    // text/plain 으로 보내야 브라우저가 사전 확인(CORS preflight) 없이 바로 보낸다
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
        return res.json();
      })
      .then(function (res) {
        clearTimeout(timer);
        setBusy(false);
        if (!res || !res.ok) {
          api.notify('제출하지 못했습니다: ' + ((res && res.error) || '알 수 없는 오류') +
                     ' (보낸 내용은 기기에 보관되어 있습니다)', true, '제출 실패', btn);
          paintLast();
          return;
        }
        writeLast({ sid: payload.sid, name: payload.name, at: res.at, count: res.count });

        // 보관본에 ‘제출됨’ 표시를 남긴다 (그사이 새 보관본이 생겼다면 건드리지 않는다)
        Archive.get(key).then(function (box) {
          if (box && box.payload === payload.__json) {
            box.sentAt = res.at;
            return Archive.put(key, box);
          }
        })['catch'](function () {}).then(paintLast);

        api.notify('제출 완료! 선생님 폴더에 ' + res.file + ' 로 저장되었습니다.' +
                   (res.count > 1 ? ' 지난 제출본은 이번 것으로 바뀌었습니다.' : ''),
                   false, '제출 완료 ✓', btn);
      })
      ['catch'](function (err) {
        clearTimeout(timer);
        setBusy(false);
        paintLast();
        var aborted = err && err.name === 'AbortError';
        api.notify((aborted ? '응답이 너무 오래 걸려 멈췄습니다. ' : '인터넷 연결 또는 제출 주소에 문제가 있습니다. ') +
                   '보낸 내용은 기기에 보관되어 있으니, 잠시 뒤 다시 눌러 보세요.',
                   true, '제출 실패', btn);
      });
  }

  /* ---------- 지금 화면의 내용으로 제출 ---------- */
  function run(btn) {
    if (busy) return;

    if (!ENDPOINT) {
      api.notify('제출 주소가 아직 설정되지 않았습니다. 선생님께 알려 주세요.', true, '제출 주소 없음', btn);
      return;
    }

    var v = api.visitor();
    if (!v) {
      api.notify('학번과 이름을 먼저 입력해 주세요.', true, '학번·이름 필요', btn);
      return;
    }

    var room = api.collectRoom();
    if (!room) {
      api.notify('아직 전시실을 고르지 않았습니다. 로비에서 전시실을 먼저 선택해 주세요.', true, '전시실 미선택', btn);
      return;
    }
    if (!room.items.length) {
      api.notify('아직 등록된 자료가 없습니다. 전시실에서 자료를 등록한 뒤 제출해 주세요.', true, '등록된 자료 없음', btn);
      return;
    }

    var gaps = missing(room);
    if (gaps.length && !window.confirm('아직 채우지 않은 곳이 있습니다.\n\n· ' + gaps.join('\n· ') +
                                       '\n\n그래도 제출할까요?')) return;

    var prev = lastFor(v);
    if (prev && !window.confirm('이미 ' + when(prev.at) + '에 제출했습니다.\n' +
                                '다시 제출하면 지난 제출본은 지금 내용으로 바뀝니다. 계속할까요?')) return;

    var payload = {
      sid: v.sid,
      name: v.name,
      room: room.id,
      reason: room.reason,
      items: room.items.map(function (it) {
        return { photo: it.photo || '', desc: it.desc || '', event: it.event || '' };
      })
    };

    // 보내기 전에 먼저 기기에 보관한다 — 전송이 실패해도 그대로 남는다
    var json = JSON.stringify(payload);
    Object.defineProperty(payload, '__json', { value: json });   // JSON에는 실리지 않는 표식
    Archive.put(keyOf(v.sid, v.name), { payload: json, savedAt: nowText(), sentAt: null })
      ['catch'](function () { /* 보관에 실패해도 제출은 계속한다 */ })
      .then(function () { send(payload, btn); });
  }

  /* ---------- 기기에 보관된 제출본을 그대로 다시 보내기 ---------- */
  function resend(btn) {
    if (busy) return;

    if (!ENDPOINT) {
      api.notify('제출 주소가 아직 설정되지 않았습니다. 선생님께 알려 주세요.', true, '제출 주소 없음', btn);
      return;
    }

    var v = api.visitor();
    if (!v) return;

    Archive.get(keyOf(v.sid, v.name)).then(function (box) {
      if (!box) {
        api.notify('이 기기에 보관된 제출본이 없습니다.', true, '보관본 없음', btn);
        paintLast();
        return;
      }
      if (!window.confirm(when(box.savedAt) + '에 보관한 제출본을 다시 보냅니다.\n' +
                          '지금 화면의 내용이 아니라 그때 보낸 내용 그대로입니다. 계속할까요?')) return;

      var payload = JSON.parse(box.payload);
      Object.defineProperty(payload, '__json', { value: box.payload });
      send(payload, btn);
    })['catch'](function () {
      api.notify('기기 보관함을 열지 못했습니다. 일반(비공개가 아닌) 창에서 다시 시도해 주세요.', true, '보관함 오류', btn);
    });
  }

  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () { run(btn); });
  });
  Array.prototype.forEach.call(resendButtons, function (btn) {
    btn.addEventListener('click', function () { resend(btn); });
  });

  paintLast();
})();
