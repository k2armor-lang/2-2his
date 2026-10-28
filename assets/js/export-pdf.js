/* =========================================================
   전시 도록 PDF 저장
   - 표지(메인 페이지 내용) + 학생이 고른 전시실 하나의 자료 세 점을
     순서대로 모아 한 장짜리 인쇄 문서를 만든 뒤 브라우저 인쇄 →
     ‘PDF로 저장’으로 넘긴다
   - 저장창에 뜨는 기본 파일명은 document.title 을 따라가므로
     인쇄 직전에 제목을 “학번_이름”으로 바꿔 둔다 (아이패드 사파리 포함)
   ========================================================= */
(function () {
  'use strict';

  var buttons = document.querySelectorAll('[data-export-pdf]');
  if (!buttons.length) return;

  var root = document.documentElement;

  // 안내 문구 자리는 로비와 전시실마다 따로 있다 (지금 보이는 곳에만 적는다)
  var statuses = document.querySelectorAll('[data-export-status]');
  var lastButton = null;   // 방금 누른 버튼 — 그 자리에서도 결과를 알린다

  // 도록에 적히는 자료 항목 이름 (index.html의 카드 문구와 짝을 맞춘다)
  var MATERIAL = {
    alt: '전시 자료 사진',
    desc: '자료 설명',
    event: '역사적 배경과 의미'
  };

  var ROOMS = [
    { id: 'room1', no: '01', years: '1910 — 1945', title: '빼앗긴 들에도 봄은 오는가' },
    { id: 'room2', no: '02', years: '1945 — 1960', title: '광복, 그리고 다시 갈라진 땅' },
    { id: 'room3', no: '03', years: '1960 — 현재', title: '산업화와 민주화, 오늘의 우리' }
  ];

  /* ---------- 도구 ---------- */
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;   // 항상 텍스트로만 넣는다
    return n;
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function visitor() {
    var v = readJSON('museum-visitor');
    return (v && v.sid && v.name) ? v : null;
  }

  // 파일 이름에 쓸 수 없는 글자를 걷어낸다
  function fileBase(v) {
    var name = v.sid + '_' + v.name;
    return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '') || '전시도록';
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  // 사진도 글도 없는 카드는 도록에서 제외한다
  function filled(items) {
    return (items || []).filter(function (it) {
      return it && (it.photo || (it.desc || '').trim() || (it.event || '').trim());
    });
  }

  // 지금 화면에 실제로 보이는 요소인지
  // (보고 있지 않은 전시실·로비는 통째로 display:none 상태다)
  function onScreen(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /* 누른 버튼 글자를 잠깐 바꿔 그 자리에서 결과를 알린다.
     원래 내용은 조각으로 떼어 두었다가 그대로 되돌리므로
     안쪽의 <span class="btn-sub">도 사라지지 않는다 */
  var btnBackup = new WeakMap();
  var btnTimer = new WeakMap();

  function flashButton(btn, short) {
    if (!btn || !short) return;

    if (!btnBackup.has(btn)) {
      var frag = document.createDocumentFragment();
      while (btn.firstChild) frag.appendChild(btn.firstChild);
      btnBackup.set(btn, frag);
    }
    clearTimeout(btnTimer.get(btn));

    btn.textContent = short;
    btnTimer.set(btn, setTimeout(function () {
      btn.textContent = '';
      btn.appendChild(btnBackup.get(btn));
      btnBackup['delete'](btn);
      btnTimer['delete'](btn);
    }, 2600));
  }

  /* msg: 안내 문구 자리에 쓸 문장 / short: 버튼 글자로 잠깐 바꿔 넣을 짧은 말

     안내 자리는 로비와 전시실마다 따로 있는데, 보고 있지 않은 화면은 숨어 있다.
     숨은 자리에만 적어 두면 학생에게는 아무 반응이 없는 것처럼 보이므로
     ① 지금 보이는 자리에만 적고 ② 오류는 누른 버튼에서 한 번 더 알린다. */
  function notify(msg, isError, short) {
    var shown = false;

    Array.prototype.forEach.call(statuses, function (el) {
      if (onScreen(el)) {
        el.textContent = msg;
        el.classList.toggle('is-error', !!isError);
        shown = true;
      } else {
        el.textContent = '';                 // 지난 안내가 남아 있지 않도록 비운다
        el.classList.remove('is-error');
      }
    });

    if (!shown || isError) flashButton(lastButton, short || msg);
  }

  /* ---------- 표지 ---------- */
  function buildCover(v, room, total) {
    var sec = el('section', 'pr-cover');

    sec.appendChild(el('p', 'pr-eyebrow', 'EXHIBITION CATALOGUE'));
    sec.appendChild(el('h1', 'pr-cover-title', '근현대 전시전 기획하기'));
    sec.appendChild(el('p', 'pr-cover-sub', '2026학년도 2학기 · 한국사2 수행평가'));
    sec.appendChild(el('div', 'pr-rule'));
    sec.appendChild(el('p', 'pr-cover-desc',
      '세 시대의 전시실 가운데 하나를 골라, 그 시대를 가장 잘 보여 주는 ' +
      '유물과 사건 자료 세 점으로 나만의 전시를 기획했습니다. ' +
      '남겨진 유물과 문화재는 그 시대를 살아낸 사람들이 우리에게 건네는 ' +
      '가장 구체적인 증언입니다.'));

    var meta = el('dl', 'pr-meta');
    [
      ['기획자', v.sid + ' · ' + v.name],
      ['과목', '한국사2 · 2학기'],
      ['작성일', today()],
      ['전시실', 'Room ' + room.no + ' · ' + room.title],
      ['전시 시기', room.years],
      ['전시 구성', '자료 ' + total + '점']
    ].forEach(function (row) {
      var wrap = document.createElement('div');
      wrap.appendChild(el('dt', null, row[0]));
      wrap.appendChild(el('dd', null, row[1]));
      meta.appendChild(wrap);
    });
    sec.appendChild(meta);

    var reasonBox = el('div', 'pr-reason');
    reasonBox.appendChild(el('h3', null, '이 전시실을 선택한 이유'));
    var reasonText = (room.reason || '').trim();
    reasonBox.appendChild(el('p', reasonText ? null : 'is-blank', reasonText || '(작성되지 않음)'));
    sec.appendChild(reasonBox);

    return sec;
  }

  /* ---------- 유물 카드 ---------- */
  function buildCard(item, index) {
    var card = el('article', 'pr-card');

    var fig = el('figure', 'pr-figure');
    if (item.photo) {
      var img = document.createElement('img');
      img.src = item.photo;
      img.alt = MATERIAL.alt + ' ' + index;
      fig.appendChild(img);
    } else {
      fig.className = 'pr-figure is-empty';
      fig.textContent = '사진 없음';
    }
    card.appendChild(fig);

    var body = el('div', 'pr-body');

    var head = el('p', 'pr-index');
    head.appendChild(el('span', null, 'EXHIBIT ' + ('0' + index).slice(-2)));
    body.appendChild(head);

    [[MATERIAL.desc, item.desc], [MATERIAL.event, item.event]].forEach(function (f) {
      var field = el('div', 'pr-field');
      field.appendChild(el('h3', null, f[0]));
      var value = (f[1] || '').trim();
      field.appendChild(el('p', value ? null : 'is-blank', value || '(작성되지 않음)'));
      body.appendChild(field);
    });

    card.appendChild(body);
    return card;
  }

  /* ---------- 인쇄 문서 만들기 ---------- */
  function buildSheet(v, room, total) {
    var sheet = el('div', 'print-sheet');
    sheet.appendChild(buildCover(v, room, total));

    var sec = el('section', 'pr-room pr-room-' + room.no);

    var head = el('header', 'pr-room-head');
    head.appendChild(el('p', 'pr-eyebrow', 'ROOM ' + room.no + ' · ' + room.years));
    head.appendChild(el('h2', 'pr-room-title', room.title));
    sec.appendChild(head);

    if (!room.items.length) {
      sec.appendChild(el('p', 'pr-empty', '이 전시실에는 아직 등록된 자료가 없습니다.'));
    } else {
      room.items.forEach(function (item, i) {
        sec.appendChild(buildCard(item, i + 1));
      });
    }

    sec.appendChild(el('p', 'pr-foot', '근현대 전시전 기획하기 · ' + v.sid + ' ' + v.name));
    sheet.appendChild(sec);

    return sheet;
  }

  /* ---------- 학생이 고른 전시실 하나를 모은다 ---------- */
  function collectRoom() {
    var choice = readJSON('museum-room-choice');
    if (!choice || !choice.room) return null;

    var info = null;
    for (var i = 0; i < ROOMS.length; i++) {
      if (ROOMS[i].id === choice.room) { info = ROOMS[i]; break; }
    }
    if (!info) return null;

    return {
      no: info.no, years: info.years, title: info.title,
      reason: choice.reason || '',
      items: filled(readJSON('museum-exhibit:' + choice.room))
    };
  }

  /* =======================================================
     저장 파일 이름을 학번_이름으로 붙잡아 두기

     저장창에 뜨는 기본 파일명은 그 순간의 문서 제목을 따라간다.
     그런데 아이패드 사파리는 인쇄 창이 뜬 뒤 ‘공유 → 파일에 저장’을
     누를 때 이름을 정하는데, 그 사이에 afterprint 가 먼저 날아와
     제목을 되돌려 버리면 페이지 제목으로 저장돼 버린다.
     그래서 인쇄가 끝나도 제목을 바로 되돌리지 않고,
     학생이 화면을 다시 만질 때까지 학번_이름을 유지한다.
     ======================================================= */
  var titleHold = null;

  function releaseTitle(e) {
    if (!titleHold) return;
    // 인쇄 창이 뜨기 전의 스크롤·오터치로 제목이 먼저 돌아가지 않게 잠깐 기다린다
    if (e && Date.now() < titleHold.keepUntil) return;

    clearTimeout(titleHold.timer);
    document.removeEventListener('pointerdown', releaseTitle, true);
    document.removeEventListener('keydown', releaseTitle, true);
    document.title = titleHold.original;
    titleHold = null;
  }

  function holdTitle(name) {
    if (!titleHold) titleHold = { original: document.title };
    else clearTimeout(titleHold.timer);

    document.title = name;
    titleHold.keepUntil = Date.now() + 3000;

    // 저장을 마치고 화면을 다시 만지면 원래 제목으로 돌아온다
    document.addEventListener('pointerdown', releaseTitle, true);
    document.addEventListener('keydown', releaseTitle, true);
    titleHold.timer = setTimeout(releaseTitle, 300000);   // 5분 뒤 자동 복구
  }

  /* ---------- 인쇄 준비 (버튼 · 브라우저 인쇄 공통) ---------- */
  function preparePrint(v, room, total, auto) {
    var old = document.querySelector('.print-sheet');
    if (old) old.remove();

    var sheet = buildSheet(v, room, total);
    if (auto) sheet.setAttribute('data-auto-sheet', '');
    document.body.appendChild(sheet);

    holdTitle(fileBase(v));        // 저장창의 기본 파일명 = 학번_이름
    root.classList.add('is-printing');
    return sheet;
  }

  /* ---------- 인쇄 실행 ---------- */
  function run() {
    var v = visitor();
    if (!v) {
      notify('학번과 이름을 먼저 입력해 주세요.', true, '학번·이름 필요');
      return;
    }

    // 어느 화면을 보고 있든, 학생이 고른 전시실 하나를 담는다
    var room = collectRoom();
    if (!room) {
      notify('아직 전시실을 고르지 않았습니다. 로비에서 전시실을 먼저 선택해 주세요.',
             true, '전시실 미선택');
      return;
    }

    var total = room.items.length;
    if (!total) {
      notify('아직 등록된 자료가 없습니다. 전시실에서 유물이나 사건 사진을 등록한 뒤 저장해 주세요.',
             true, '등록된 자료 없음');
      return;
    }

    var sheet = preparePrint(v, room, total, false);

    // 인쇄가 끝나면 화면만 되돌린다 (제목은 저장이 끝날 때까지 그대로 둔다)
    var restored = false;
    function restoreLayout() {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restoreLayout);
      root.classList.remove('is-printing');
      if (sheet.parentNode) sheet.remove();
    }
    window.addEventListener('afterprint', restoreLayout);
    // afterprint 를 보내지 않는 브라우저를 위한 안전장치
    setTimeout(restoreLayout, 120000);

    notify(room.title + ' 자료 ' + total + '점을 담았습니다. 인쇄 창에서 ‘PDF로 저장’을 고르세요. ' +
           '파일명은 ' + fileBase(v) + '.pdf 로 채워집니다.',
           false, '인쇄 창을 엽니다…');

    // 사진·글꼴이 자리를 잡고, 바뀐 제목이 반영될 시간을 준 뒤 인쇄 창을 연다
    setTimeout(function () { window.print(); }, 450);
  }

  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () {
      lastButton = btn;      // 결과를 이 버튼 자리에서도 알릴 수 있게 기억해 둔다
      run();
    });
  });

  /* ---------- 안전장치 ----------
     버튼 대신 브라우저 인쇄(Ctrl+P · 공유▸프린트)를 눌렀을 때도
     지금 보고 있는 화면 그대로가 아니라 표지를 갖춘 도록 문서를 만들고,
     파일 이름도 똑같이 학번_이름으로 맞춘다. */
  window.addEventListener('beforeprint', function () {
    var v = visitor();
    if (!v) return;                                       // 학번·이름이 없으면 그대로 둔다

    if (document.querySelector('.print-sheet')) {          // 버튼으로 이미 만든 경우
      holdTitle(fileBase(v));                              // 제목만 다시 확인해 둔다
      return;
    }

    var room = collectRoom();
    if (!room || !room.items.length) return;

    preparePrint(v, room, room.items.length, true);
  });

  window.addEventListener('afterprint', function () {
    var auto = document.querySelector('.print-sheet[data-auto-sheet]');
    if (!auto) return;
    auto.remove();
    root.classList.remove('is-printing');
  });
})();
