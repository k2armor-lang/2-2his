/* =========================================================
   기획자 입장 화면 — 학번 · 이름
   - 저장된 정보가 없으면 전체 화면 입장 화면을 띄우고 본문을 잠근다
   - 입장 후에는 모든 페이지 상단에 기획자 학번·이름을 작게 표시
   - ‘학번·이름 수정’ 버튼으로 다시 열어 고칠 수 있다
   ※ 학교 과제용 화면 잠금이며 보안 장치는 아닙니다.
      (브라우저 저장소를 지우거나 자바스크립트를 끄면 열립니다)
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'museum-visitor';
  var root = document.documentElement;

  var bar = document.querySelector('[data-visitor-bar]');
  var text = document.querySelector('[data-visitor-text]');
  var editBtn = document.querySelector('[data-visitor-edit]');
  var outBtn = document.querySelector('[data-visitor-logout]');

  var overlay = null;
  var lastFocused = null;

  // 원래 페이지 제목 — 학번·이름이 없을 때는 이 제목으로 돌아간다
  var pageTitle = document.title;

  /* 저장 파일 이름 (= 페이지 제목)
     아이패드에서 'PDF로 저장'을 하면 이 제목이 그대로 파일 이름이 된다.
     export-pdf.js 의 fileBase() 와 같은 규칙을 쓴다. */
  function fileName(v) {
    var name = v.sid + '_' + v.name;
    return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '');
  }

  /* ---------- 저장 / 불러오기 ---------- */
  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var v = raw ? JSON.parse(raw) : null;
      return (v && v.sid && v.name) ? v : null;
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

  /* ---------- 상단 표시줄 + 페이지 제목 ---------- */
  function paint(v) {
    // 학번·이름을 넣는 순간 페이지 제목이 학번_이름이 된다
    document.title = v ? (fileName(v) || pageTitle) : pageTitle;

    if (!bar || !text) return;
    if (v) {
      text.textContent = v.sid + ' · ' + v.name;
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  /* ---------- 입장 화면 만들기 ---------- */
  function build() {
    var el = document.createElement('div');
    el.className = 'gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'gate-title');
    el.innerHTML =
      '<form class="gate-card" novalidate>' +
        '<p class="gate-brand"><span class="brand-mark">◈</span> 2026학년도 2학기 한국사2 수행평가</p>' +
        '<p class="eyebrow">CURATOR</p>' +
        '<h1 class="gate-title" id="gate-title">전시를 기획하기 전에</h1>' +
        '<p class="gate-desc"><b class="gate-assign">근현대 전시전 기획하기</b>' +
          '<br>한국사2 2학기 수행평가입니다. 전시를 기획할 사람의 학번과 이름을 넣으면 전시실이 열립니다.</p>' +
        '<div class="gate-field">' +
          '<label class="gate-label" for="gate-sid">학번</label>' +
          '<input class="gate-input" id="gate-sid" type="text" inputmode="numeric" ' +
                 'autocomplete="off" maxlength="12" placeholder="예) 11101">' +
        '</div>' +
        '<div class="gate-field">' +
          '<label class="gate-label" for="gate-name">이름</label>' +
          '<input class="gate-input" id="gate-name" type="text" ' +
                 'autocomplete="off" maxlength="20" placeholder="예) 홍길동">' +
        '</div>' +
        '<p class="gate-error" data-gate-error role="alert"></p>' +
        '<div class="gate-actions">' +
          '<button class="btn btn-primary" type="submit" data-gate-submit>기획 시작하기</button>' +
          '<button class="btn btn-ghost" type="button" data-gate-cancel hidden>취소</button>' +
        '</div>' +
        '<p class="gate-note">제출 파일은 <b>학번_이름.pdf</b>(예: 11101_홍길동.pdf)로 저장됩니다.<br>' +
          '입력한 정보는 이 브라우저에만 저장되며 어디로도 전송되지 않습니다.<br>' +
          '처음이라면 <a class="gate-link" href="guide.html">사용 안내</a>를 먼저 읽어 보세요.</p>' +
      '</form>';
    return el;
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    root.classList.remove('is-locked');
    if (lastFocused && document.contains(lastFocused)) {
      try { lastFocused.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
    }
    lastFocused = null;
  }

  function open(mode) {
    if (overlay) return;
    lastFocused = document.activeElement;

    var current = read();
    overlay = build();
    document.body.appendChild(overlay);

    var form = overlay.querySelector('form');
    var sid = overlay.querySelector('#gate-sid');
    var name = overlay.querySelector('#gate-name');
    var err = overlay.querySelector('[data-gate-error]');
    var cancel = overlay.querySelector('[data-gate-cancel]');

    var isEdit = (mode === 'edit' && current);

    if (isEdit) {
      overlay.querySelector('.gate-title').textContent = '학번 · 이름 수정';
      overlay.querySelector('.gate-desc').textContent =
        '표시할 학번과 이름을 고쳐 주세요. 작성한 전시 내용은 그대로 남습니다.';
      overlay.querySelector('[data-gate-submit]').textContent = '저장';
      cancel.hidden = false;
      sid.value = current.sid;
      name.value = current.name;
    }

    function fail(msg, field) {
      err.textContent = msg;
      err.classList.add('is-on');
      field.focus();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var s = sid.value.replace(/\s+/g, '');
      var n = name.value.trim().replace(/\s+/g, ' ');

      if (!s) return fail('학번을 입력해 주세요.', sid);
      if (!/^[0-9-]{2,12}$/.test(s)) return fail('학번은 숫자로 입력해 주세요. (예: 11101)', sid);
      if (!n) return fail('이름을 입력해 주세요.', name);

      if (!write({ sid: s, name: n })) {
        return fail('브라우저 저장 기능을 쓸 수 없습니다. 시크릿 모드가 아닌 창에서 열어 주세요.', sid);
      }

      paint({ sid: s, name: n });
      close();

      // 처음 입장할 때는 주소에 #room1 같은 게 남아 있어도 로비부터 보여 준다
      if (!isEdit && location.hash !== '#lobby') location.hash = '#lobby';
    });

    // 취소 (수정할 때만)
    cancel.addEventListener('click', close);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isEdit) close();

      // 입장 화면 안에서만 탭 이동이 돌도록 가둔다
      if (e.key !== 'Tab') return;
      var items = overlay.querySelectorAll('input, button:not([hidden]), a');
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    sid.focus();
  }

  /* ---------- 시작 ---------- */
  var visitor = read();
  if (visitor) {
    root.classList.remove('is-locked');
    paint(visitor);
  } else {
    root.classList.add('is-locked');
    paint(null);
    open('enter');
  }

  if (editBtn) {
    editBtn.addEventListener('click', function () { open('edit'); });
  }

  /* ---------- 로그아웃 ----------
     학번·이름과 세 전시실에 쓴 내용을 모두 지우고 처음 입력 화면으로 돌아간다.
     되돌릴 수 없으므로 반드시 한 번 물어본다. */
  function wipe() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('museum-') === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (err) { /* 저장소를 못 쓰면 지울 것도 없다 */ }
  }

  if (outBtn) {
    outBtn.addEventListener('click', function () {
      var ok = window.confirm(
        '로그아웃하면 학번·이름과 선택한 전시실에 작성한 내용이 모두 지워집니다.\n' +
        '아직 선생님께 제출하지 않았다면 먼저 제출해 주세요.\n\n' +
        '정말 처음 화면으로 돌아갈까요?');
      if (!ok) return;

      wipe();
      // 주소에 남은 #room1 등을 떼고 완전히 처음 상태로 다시 연다
      location.replace(location.pathname + location.search);
    });
  }
})();
