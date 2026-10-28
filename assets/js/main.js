/* =========================================================
   화면 전환 · 공통 네비게이션
   - 로비와 (선택한) 전시실 하나를 한 파일 안에서 화면 단위로 갈아 끼운다
     (주소의 #room1 처럼 직접 열려 해도, 선택하지 않은 전시실이면
      로비의 전시실 고르기 구획으로 되돌려 보낸다)
   - 로비의 전시실 카드에는 선택 여부와 작성 상태를 표시한다
   ========================================================= */

/* ---------- 0. 전시실 선택 저장소 (여러 화면·파일이 함께 쓴다) ---------- */
var RoomChoice = (function () {
  'use strict';

  var KEY = 'museum-room-choice';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var v = raw ? JSON.parse(raw) : null;
      return (v && v.room) ? v : null;
    } catch (err) {
      return null;
    }
  }

  function write(v) {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
      return true;
    } catch (err) {
      return false;
    }
  }

  function room() {
    var v = read();
    return v ? v.room : null;
  }

  // 아직 아무 전시실도 고르지 않았을 때만 선택이 확정된다
  function select(roomId) {
    if (read()) return;
    write({ room: roomId, reason: '' });
  }

  function saveReason(roomId, reason) {
    var v = read();
    if (!v || v.room !== roomId) return;
    v.reason = reason;
    write(v);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (err) { /* 무시 */ }
  }

  return { read: read, room: room, select: select, saveReason: saveReason, clear: clear };
})();

/* ---------- 1. 접이식 네비게이션 토글 (태블릿 세로 900px 이하) ---------- */
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;

  // CSS의 13-2 구간과 같은 폭을 쓴다
  var NAV_BREAKPOINT = 900;

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // 메뉴 항목 선택 시 닫기
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  // 메뉴 밖을 누르면 닫기 (태블릿에서 실수로 열어 두기 쉬운 탓)
  document.addEventListener('pointerdown', function (e) {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  // ESC로 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });

  // 가로 메뉴가 다시 보이는 폭(태블릿 가로 회전 포함)이 되면 상태 초기화
  window.addEventListener('resize', function () {
    if (window.innerWidth > NAV_BREAKPOINT) setOpen(false);
  });
  window.addEventListener('orientationchange', function () {
    setOpen(false);
  });
})();

/* ---------- 2. 화면(로비 · 전시실) 전환 ---------- */
(function () {
  'use strict';

  var views = document.querySelectorAll('[data-view]');
  if (!views.length) return;

  var DEFAULT_VIEW = 'lobby';
  var current = null;

  function viewByName(name) {
    for (var i = 0; i < views.length; i++) {
      if (views[i].getAttribute('data-view') === name) return views[i];
    }
    return null;
  }

  // 주소의 #아이디가 어느 화면에 속하는지 찾는다 (#export → 로비)
  function locate(id) {
    var el = id ? document.getElementById(id) : null;
    if (!el) return { view: DEFAULT_VIEW, target: null };

    var holder = el.closest('[data-view]');
    if (!holder) return { view: DEFAULT_VIEW, target: el };

    return {
      view: holder.getAttribute('data-view'),
      target: (el === holder) ? null : el   // 화면 자체를 가리키면 맨 위로
    };
  }

  // 상단·바닥글 메뉴에 지금 보고 있는 화면을 표시
  // (화면 자체를 가리키는 링크만 표시한다. #export처럼 화면 안의 한 구획을
  //  가리키는 링크까지 켜지면 탭이 두 개 켜진 것처럼 보인다)
  function markMenus(name) {
    var links = document.querySelectorAll('.nav-list a[href^="#"], .footer-nav a[href^="#"]');
    Array.prototype.forEach.call(links, function (a) {
      var spot = locate(a.getAttribute('href').slice(1));
      if (spot.view === name && !spot.target) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  function show(name, target) {
    var next = viewByName(name) || viewByName(DEFAULT_VIEW);
    if (!next) return;

    var changed = (next !== current);

    Array.prototype.forEach.call(views, function (v) {
      v.classList.toggle('is-active', v === next);
    });
    current = next;
    markMenus(next.getAttribute('data-view'));

    if (target) {
      target.scrollIntoView();
    } else if (changed) {
      window.scrollTo(0, 0);
    }

    if (changed) {
      // 숨어 있던 동안에는 높이를 잴 수 없다 — 각 화면이 스스로 다시 맞추도록 알린다
      document.dispatchEvent(new CustomEvent('view:shown', {
        detail: { view: next.getAttribute('data-view'), el: next }
      }));

      // 화면이 바뀐 것을 스크린 리더에도 알린다
      var heading = next.querySelector('h1, h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        try { heading.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
      }
    }
  }

  // 선택하지 않은 전시실(#room1 등)로 바로 들어오려 하면
  // 로비의 '전시실 고르기' 구획으로 돌려보낸다
  function guard(spot) {
    if (!/^room[123]$/.test(spot.view)) return spot;
    if (RoomChoice.room() === spot.view) return spot;
    return locate('rooms');
  }

  function route() {
    var spot = guard(locate(location.hash.slice(1)));
    show(spot.view, spot.target);
  }

  window.addEventListener('hashchange', route);

  // 같은 주소를 다시 눌렀을 때도 그 화면으로 가도록 (hashchange가 일어나지 않는 경우)
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id || ('#' + id) !== location.hash) return;
    e.preventDefault();
    route();
  });

  route();
})();

/* ---------- 3. 전시실 고르기 · 로비 카드 상태 ----------
   카드 상태는 세 가지 층위로 나뉜다.
   - available : 아직 아무 전시실도 고르지 않아, 세 카드 모두 고를 수 있다
   - locked    : 다른 전시실을 이미 골라서, 이 카드는 들어갈 수 없다
   - chosen    : 내가 고른 그 전시실 — 배지는 실제 작성 진행도를 보여 준다
   ========================================================= */
(function () {
  'use strict';

  var grid = document.querySelector('[data-room-grid]');
  var badges = document.querySelectorAll('[data-room-status]');
  var pickNote = document.querySelector('[data-room-pick-note]');
  if (!grid && !badges.length) return;

  var ROOMS = ['room1', 'room2', 'room3'];
  var ROOM_NO = { room1: '1', room2: '2', room3: '3' };
  var ROOM_TITLE = { room1: '제1전시실', room2: '제2전시실', room3: '제3전시실' };

  function readExhibit(room) {
    try {
      var raw = localStorage.getItem('museum-exhibit:' + room);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  var BADGE_LABEL = {
    available: '미선택',
    locked:    '선택 안 함',
    empty:     '아직 비어 있음',
    partial:   '작성 중',
    done:      '작성 완료 ✓'
  };

  function paintBadge(room, state) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-room-status="' + room + '"]'),
      function (el) {
        el.textContent = BADGE_LABEL[state];
        el.className = 'room-status is-' + state;
      }
    );
  }

  function paintCard(room, cardState) {
    var card = document.querySelector('[data-room-card="' + room + '"]');
    if (!card) return;

    card.classList.toggle('is-locked', cardState === 'locked');
    card.classList.toggle('is-chosen', cardState === 'chosen');
    if (cardState === 'locked') {
      card.removeAttribute('href');
      card.setAttribute('aria-disabled', 'true');
    } else {
      card.setAttribute('href', '#' + room);
      card.removeAttribute('aria-disabled');
    }

    var text = card.querySelector('[data-room-enter-text]');
    if (!text) return;
    if (cardState === 'locked') text.textContent = '선택하지 않음';
    else if (cardState === 'chosen') text.textContent = '내 전시실 열기';
    else text.textContent = '제' + ROOM_NO[room] + '전시실 선택하기';
  }

  function paintNote(chosenRoom) {
    if (!pickNote) return;

    if (!chosenRoom) {
      pickNote.textContent = '한 곳만 고를 수 있습니다';
      return;
    }

    pickNote.textContent = '';
    pickNote.appendChild(document.createTextNode(ROOM_TITLE[chosenRoom] + ' 선택됨 '));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-note-action';
    btn.setAttribute('data-room-switch', '');
    btn.textContent = '다른 전시실로 바꾸기';
    pickNote.appendChild(btn);
  }

  function paint() {
    var choice = RoomChoice.read();
    var chosenRoom = choice ? choice.room : null;

    ROOMS.forEach(function (room) {
      var badgeState, cardState;

      if (!chosenRoom) {
        badgeState = cardState = 'available';
      } else if (chosenRoom !== room) {
        badgeState = cardState = 'locked';
      } else {
        cardState = 'chosen';

        var items = readExhibit(room);
        var reasonFilled = !!(choice.reason || '').trim();
        var anyItem = items.some(function (it) {
          return it && (it.photo || (it.desc || '').trim() || (it.event || '').trim());
        });
        var allDone = items.length >= 3 && items.slice(0, 3).every(function (it) {
          return it && it.photo && (it.desc || '').trim() && (it.event || '').trim();
        });

        badgeState = (allDone && reasonFilled) ? 'done'
                   : (reasonFilled || anyItem) ? 'partial'
                   : 'empty';
      }

      paintBadge(room, badgeState);
      paintCard(room, cardState);
    });

    paintNote(chosenRoom);
  }

  var confirmDialog = document.querySelector('[data-room-confirm]');
  var pendingCard = null;
  if (confirmDialog) {
    confirmDialog.addEventListener('close', function () {
      var card = pendingCard;
      pendingCard = null;
      if (!card) return;
      if (confirmDialog.returnValue === 'select' && !RoomChoice.room()) {
        var room = card.getAttribute('data-room-card');
        RoomChoice.select(room);
        location.hash = '#' + room;
      } else {
        card.focus();
      }
    });
  }

  // 아직 고르지 않았을 때만 확인 후 선택이 확정된다
  // (골랐다면 링크가 그대로 살아 있어 클릭하면 그 전시실로 들어간다)
  if (grid) {
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('[data-room-card]');
      if (!card || RoomChoice.room()) return;
      var room = card.getAttribute('data-room-card');
      if (confirmDialog && typeof confirmDialog.showModal === 'function') {
        e.preventDefault();
        pendingCard = card;
        confirmDialog.className = 'room-confirm theme-' + room;
        confirmDialog.querySelector('[data-room-confirm-name]').textContent =
          ROOM_TITLE[room] + ' · ' + card.querySelector('.room-name').innerText.trim().replace(/\s+/g, ' ');
        confirmDialog.returnValue = '';
        confirmDialog.showModal();
        return;
      }
      var confirmed = window.confirm(
        ROOM_TITLE[room] + '로 선택하고 입장할까요?\n' +
        '전시실은 한 곳만 선택할 수 있으며, 다른 곳으로 바꾸면 작성한 내용이 사라집니다.');
      if (!confirmed) {
        e.preventDefault();
        return;
      }
      RoomChoice.select(room);
    });
  }

  // '다른 전시실로 바꾸기' — 확인 후 선택과 그 전시실에 쓴 내용을 모두 지운다
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-room-switch]');
    if (!btn) return;

    var choice = RoomChoice.read();
    if (!choice) return;

    var ok = window.confirm(
      ROOM_TITLE[choice.room] + '을(를) 그만두고 다른 전시실을 고르면\n' +
      '지금까지 쓴 선택 이유와 자료 세 점이 모두 사라집니다.\n\n' +
      '정말 다른 전시실로 바꿀까요?');
    if (!ok) return;

    try { localStorage.removeItem('museum-exhibit:' + choice.room); } catch (err) { /* 무시 */ }
    RoomChoice.clear();
    location.hash = '#lobby';
    location.reload();
  });

  // 로비로 돌아올 때마다 다시 계산한다
  document.addEventListener('view:shown', function (e) {
    if (e.detail && e.detail.view === 'lobby') paint();
  });
  // 전시실에서 내용을 고치면 바로 반영
  document.addEventListener('exhibit:saved', paint);
  document.addEventListener('room-reason:saved', paint);

  paint();
})();

/* ---------- 글칸 높이 맞추기 (exhibit.js 도 함께 쓴다) ----------
   글이 늘면 칸도 함께 늘린다. 다만 한 화면을 넘지 않도록 CSS의 max-height에서 멈추고,
   그보다 긴 글은 칸 안에서 밀어 올려 본다(is-capped). 제출본에는 글 전체가 펼쳐져 들어간다. */
window.fitField = function (area) {
  if (!area || !area.offsetWidth) return;          // 숨어 있으면 잴 수 없다 — 나타날 때 다시 부른다
  var pageY = window.pageYOffset;
  var atEnd = area.selectionEnd === area.value.length;
  var inner = area.scrollTop;

  area.style.height = 'auto';
  var border = area.offsetHeight - area.clientHeight;   // box-sizing: border-box 라 테두리만큼 더한다
  area.style.height = (area.scrollHeight + border) + 'px';

  var capped = area.scrollHeight > area.clientHeight + 1;
  area.classList.toggle('is-capped', capped);
  // 높이를 잠깐 auto로 돌리면 칸 안·화면 스크롤이 튈 수 있어 제자리로 돌려 둔다
  area.scrollTop = (capped && atEnd && document.activeElement === area) ? area.scrollHeight : inner;
  if (window.pageYOffset !== pageY) window.scrollTo(window.pageXOffset, pageY);
};

/* 화면 회전·분할 화면 변경 시 글줄 수에 맞게 입력칸 높이를 다시 계산한다.
   숨긴 카드에는 손대지 않으며, 학생이 쓴 값과 저장 상태는 바꾸지 않는다. */
(function () {
  var resizeFrame = null;
  window.addEventListener('resize', function () {
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = null;
      Array.prototype.forEach.call(document.querySelectorAll('textarea.field-input'), window.fitField);
    });
  });
})();

/* ---------- 4. 전시실을 고른 이유 — 저장 / 불러오기 ----------
   선택한 전시실 하나에만 딸린 값이라 exhibit.js의 카드 저장과는 따로,
   RoomChoice(전시실 선택 저장소)에 함께 담아 둔다. */
(function () {
  'use strict';

  var areas = document.querySelectorAll('[data-room-reason]');
  if (!areas.length) return;

  function autoGrow(el) { window.fitField(el); }

  Array.prototype.forEach.call(areas, function (ta) {
    var section = ta.closest('[data-view]');
    var roomId = section ? section.getAttribute('data-view') : null;
    if (!roomId) return;

    var saveTimer = null;

    function load() {
      var choice = RoomChoice.read();
      ta.value = (choice && choice.room === roomId) ? (choice.reason || '') : '';
    }

    ta.addEventListener('input', function () {
      autoGrow(ta);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        RoomChoice.saveReason(roomId, ta.value);
        document.dispatchEvent(new CustomEvent('room-reason:saved', { detail: { room: roomId } }));
      }, 350);
    });

    // 숨어 있는 동안에는 scrollHeight를 잴 수 없어, 화면에 나타날 때 다시 맞춘다
    document.addEventListener('view:shown', function (e) {
      if (!e.detail || e.detail.view !== roomId) return;
      autoGrow(ta);
    });

    load();
    autoGrow(ta);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { autoGrow(ta); });
  });
})();
