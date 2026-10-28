/* =========================================================
   선생님께 제출하기
   - 학생 기기에서 전시실 화면과 같은 모양의 PDF를 만들어 Apps Script 웹 앱(apps-script/Code.gs)으로 보낸다
   - 웹 앱은 그 PDF를 선생님 드라이브에 학번_이름.pdf 로 저장한다
     (기기에서 PDF를 못 만들면 글과 사진을 보내고, 웹 앱이 도록 문서를 대신 만든다)
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
        if (!btn.hasAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
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

  /* =======================================================
     제출본 PDF — 학생이 보던 전시실 화면 모양 그대로
     - 전시실 머리말 · 선택 이유 · 자료 카드를 화면과 같은 디자인으로 화면 밖에 다시 그리고
       html2canvas로 찍어 jsPDF로 A4에 차례로 붙인다
     - 화면의 글칸은 한 화면 높이에서 멈추지만, 제출본에는 글 전체를 펼쳐 싣는다
     - 라이브러리를 못 불러오거나 그리다 실패하면 거절(reject)한다
       → run()이 예전 방식(글과 사진을 보내 Apps Script가 문서를 만드는 방식)으로 보낸다
     ======================================================= */
  var LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];
  var libsReady = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('불러오기 실패: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadLibs() {
    if (window.html2canvas && window.jspdf) return Promise.resolve();
    if (!libsReady) {
      libsReady = Promise.all(LIBS.map(loadScript));
      libsReady['catch'](function () { libsReady = null; });   // 다음 제출 때 다시 시도한다
    }
    return libsReady;
  }

  function node(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;   // 학생 글은 항상 텍스트로만 넣는다
    return n;
  }

  function textBox(label, value) {
    var field = node('div', 'field');
    field.appendChild(node('span', 'field-label', label));
    var text = (value || '').trim();
    field.appendChild(node('div', 'field-input sheet-text' + (text ? '' : ' is-blank'), text || '(작성되지 않음)'));
    return field;
  }

  function sheetTop(v, room, at) {
    var top = node('div', 'sheet-block sheet-top');
    top.setAttribute('data-sheet-block', '');

    var bar = node('div', 'sheet-bar');
    var who = node('span', null, '기획자 ');
    who.appendChild(node('b', null, v.sid + ' · ' + v.name));
    bar.appendChild(who);
    bar.appendChild(node('span', null, '제출 ' + at));
    top.appendChild(bar);

    var brand = node('p', 'sheet-brand');
    brand.appendChild(node('span', 'sheet-mark', '史'));
    brand.appendChild(document.createTextNode('근현대 전시전 기획하기'));
    top.appendChild(brand);

    // 전시실 머리말은 화면의 것을 그대로 옮겨 온다
    var src = document.querySelector('#' + room.id + ' .room-head');
    var head = src ? src.cloneNode(true) : node('header', 'room-head');
    if (!src) {
      head.appendChild(node('p', 'eyebrow', room.years));
      head.appendChild(node('h2', 'room-heading', room.title));
    }
    head.insertBefore(node('p', 'sheet-room-no', '제' + Number(room.no) + '전시실'), head.firstChild);
    top.appendChild(head);

    var reason = node('div', 'room-reason');
    reason.appendChild(textBox('이 전시실을 선택한 이유', room.reason));
    top.appendChild(reason);
    return top;
  }

  function sheetCard(item, i) {
    var card = node('article', 'artifact-card sheet-block');
    card.setAttribute('data-sheet-block', '');

    var done = item.photo && (item.desc || '').trim() && (item.event || '').trim();
    var head = node('header', 'card-head');
    head.appendChild(node('span', 'sheet-index', 'EXHIBIT ' + ('0' + (i + 1)).slice(-2)));
    head.appendChild(node('span', 'card-status is-' + (done ? 'done' : 'partial'), done ? '완성 ✓' : '작성 중'));
    card.appendChild(head);

    var body = node('div', 'card-body');
    var frame = node('div', 'artifact-frame');
    var mat = node('div', 'artifact-mat');
    var box = node('div', 'sheet-photo' + (item.photo ? '' : ' is-empty'));
    if (item.photo) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = item.photo;
      box.appendChild(img);
    } else {
      box.textContent = '사진 없음';
    }
    mat.appendChild(box);
    frame.appendChild(mat);
    body.appendChild(frame);

    var plate = node('div', 'artifact-plate');
    plate.appendChild(textBox('자료 설명', item.desc));
    plate.appendChild(textBox('역사적 배경과 의미', item.event));
    body.appendChild(plate);

    card.appendChild(body);
    return card;
  }

  // html2canvas는 object-fit을 그리지 못한다 — 사진 크기를 직접 계산해 칸 안에 맞춘다
  function fitPhotos(sheet) {
    var imgs = sheet.querySelectorAll('.sheet-photo img');
    return Promise.all(Array.prototype.map.call(imgs, function (img) {
      return new Promise(function (resolve) {
        function fit() {
          var box = img.parentNode;
          var s = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight) || 1;
          img.style.width = Math.round(img.naturalWidth * s) + 'px';
          img.style.height = Math.round(img.naturalHeight * s) + 'px';
          resolve();
        }
        if (img.complete && img.naturalWidth) fit();
        else { img.onload = fit; img.onerror = function () { resolve(); }; }
      });
    }));
  }

  function renderPdf(sheet) {
    var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    var M = 10, W = 190, H = 277, GAP = 6;   // A4 210×297mm, 여백 10mm
    var y = M;

    function paintBg() { pdf.setFillColor(250, 249, 246); pdf.rect(0, 0, 210, 297, 'F'); }   // 전시실 벽 색
    function newPage() { pdf.addPage(); paintBg(); y = M; }
    function add(canvas, h) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', M, y, W, h);
      y += h + GAP;
    }

    // 글줄 한가운데서 쪽이 갈리지 않도록, 자를 자리 위쪽에서 글자가 없는 가로줄을 찾는다
    function gapAbove(canvas, cut, range) {
      var w = canvas.width;
      var data = canvas.getContext('2d').getImageData(0, cut - range, w, range).data;
      for (var row = range - 1; row >= 0; row--) {
        var dark = false;
        for (var x = 0, i = row * w * 4; x < w; x++, i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] < 480) { dark = true; break; }   // 글자(진한 색)가 있는 줄
        }
        if (!dark) return cut - range + row + 1;
      }
      return cut;   // 빈 줄이 없으면 원래 자리에서 자른다
    }

    function put(canvas) {
      var h = canvas.height * W / canvas.width;
      if (h <= H - (y - M)) return add(canvas, h);           // 이 쪽 남은 자리에 들어간다
      if (h <= H) { newPage(); return add(canvas, h); }       // 다음 쪽으로 넘긴다
      // 한 쪽보다 긴 카드(글이 아주 긴 경우)는 쪽 높이로 나눠 이어 싣는다
      if (y > M) newPage();
      var pagePx = Math.floor(H * canvas.width / W);
      for (var sy = 0, sh; sy < canvas.height; sy += sh) {
        sh = Math.min(pagePx, canvas.height - sy);
        if (sy + sh < canvas.height) sh = gapAbove(canvas, sy + sh, Math.floor(pagePx / 4)) - sy;
        var part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = sh;
        part.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        if (sy > 0) newPage();
        add(part, sh * W / canvas.width);
      }
    }

    paintBg();
    var blocks = Array.prototype.slice.call(sheet.querySelectorAll('[data-sheet-block]'));
    return blocks.reduce(function (chain, block) {
      return chain.then(function () {
        // 아이패드 캔버스 한도(약 1,600만 화소) 안에서 되도록 선명하게
        var scale = Math.min(2, Math.sqrt(14e6 / Math.max(1, block.offsetWidth * block.offsetHeight)));
        return window.html2canvas(block, { scale: scale, backgroundColor: '#faf9f6', logging: false });
      }).then(put);
    }, Promise.resolve()).then(function () {
      var n = pdf.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(i + ' / ' + n, 105, 292, { align: 'center' });
      }
      return pdf.output('datauristring').replace(/^data:application\/pdf;[^,]*base64,/, 'data:application/pdf;base64,');
    });
  }

  function makeSheetPdf(v, room) {
    return loadLibs().then(function () {
      var sheet = node('div', 'submit-sheet theme-' + room.id);
      sheet.setAttribute('aria-hidden', 'true');
      sheet.appendChild(sheetTop(v, room, nowText().slice(0, 16)));
      room.items.forEach(function (it, i) { sheet.appendChild(sheetCard(it, i)); });
      document.body.appendChild(sheet);

      var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      return fonts
        .then(function () { return fitPhotos(sheet); })
        .then(function () { return renderPdf(sheet); })
        .then(function (uri) { sheet.remove(); return uri; },
              function (err) { sheet.remove(); throw err; });
    });
  }
  window.MuseumSubmitSheet = makeSheetPdf;   // 확인용 (콘솔에서 미리 만들어 볼 때)

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

    // 제출 전에는 항상 한 번 묻는다 — 빈칸·재제출 경고도 같은 창에 함께 싣는다
    var gaps = missing(room);
    var prev = lastFor(v);
    var ask = '정말 선생님께 제출할까요?\n\n' +
              v.sid + ' ' + v.name + ' · 제' + Number(room.no) + '전시실 · 자료 ' + room.items.length + '점';
    if (gaps.length) ask += '\n\n⚠ 아직 채우지 않은 곳이 있습니다.\n· ' + gaps.join('\n· ');
    if (prev) ask += '\n\n⚠ 이미 ' + when(prev.at) + '에 제출했습니다. 지금 내용으로 바뀝니다.';
    if (!window.confirm(ask)) return;

    // 사진도 늘 함께 싣는다 — Apps Script가 PDF를 받으면 사진은 무시하고,
    // PDF를 못 만들었거나 예전 버전의 Apps Script라면 이 글과 사진으로 문서를 만든다
    var payload = {
      sid: v.sid,
      name: v.name,
      room: room.id,
      reason: room.reason,
      items: room.items.map(function (it) {
        return { photo: it.photo || '', hasPhoto: !!it.photo, desc: it.desc || '', event: it.event || '' };
      })
    };

    setBusy(true);
    api.notify('제출본을 만드는 중입니다. 화면을 닫지 말고 잠시 기다려 주세요.', false, null, btn);

    makeSheetPdf(v, room)
      .then(function (pdf) {
        payload.pdf = pdf;   // 전시실 화면 모양 그대로 만든 제출본
      }, function (err) {
        if (window.console) console.warn('제출본 PDF를 만들지 못해 글과 사진으로만 보냅니다.', err);
      })
      .then(function () {
        // 보내기 전에 먼저 기기에 보관한다 — 전송이 실패해도 그대로 남는다
        var json = JSON.stringify(payload);
        Object.defineProperty(payload, '__json', { value: json });   // JSON에는 실리지 않는 표식
        return Archive.put(keyOf(v.sid, v.name), { payload: json, savedAt: nowText(), sentAt: null })
          ['catch'](function () { /* 보관에 실패해도 제출은 계속한다 */ });
      })
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
