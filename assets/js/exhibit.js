/* =========================================================
   전시 자료 카드 컴포넌트
   - 전시실마다 따로 동작한다
   - 자료는 유물·문화재든 역사적 사건 사진이든 한 가지 형식으로 등록한다
     (예전에는 종류를 먼저 고르게 했지만, 학생들이 헷갈려 해서 하나로 합쳤다)
   - 사진 첨부(클릭 / 드래그앤드롭) → 카드 안 미리보기
   - 서술칸 두 개 (길이 제한 없음, 자동 높이)
   - 입력 내용은 전시실별로 브라우저(localStorage)에 자동 저장
   ========================================================= */
(function () {
  'use strict';

  var tpl = document.getElementById('tpl-artifact-card');
  var grids = document.querySelectorAll('[data-exhibit-grid]');
  if (!tpl || !grids.length) return;

  var DEFAULT_CARDS = 3;   // 처음부터 놓이는 카드 수 — 세 장을 다 채워야 한다는 것을 바로 보이게 한다
  var MAX_CARDS = 3;       // 한 전시실에 전시할 수 있는 자료 수
  var MAX_EDGE = 1200;     // 저장용 이미지 최대 변 길이(px)
  var JPEG_QUALITY = 0.8;
  var RETRY_EDGE = 900;    // 저장 공간이 모자랄 때 한 번 더 줄이는 기준
  var RETRY_QUALITY = 0.6;

  Array.prototype.forEach.call(grids, function (grid) { initRoom(grid); });

  /* =======================================================
     전시실 하나를 담당한다
     ======================================================= */
  function initRoom(grid) {

    // 버튼과 안내 문구는 같은 전시실 영역 안에서만 찾는다
    var scope = grid.closest('.room-section') || document;
    var addBtn = scope.querySelector('[data-add-card]');
    var stateEl = scope.querySelector('[data-save-state]');
    var addLabel = scope.querySelector('[data-add-label]');
    var progEl = scope.querySelector('[data-exhibit-progress]');

    var ROOM_ID = grid.getAttribute('data-room') || 'room';
    var STORAGE_KEY = 'museum-exhibit:' + ROOM_ID;

    /* ---------- 상태 표시 ---------- */
    var stateTimer = null;
    function setState(text, isError) {
      if (!stateEl) return;
      stateEl.textContent = text;
      stateEl.classList.toggle('is-error', !!isError);
      clearTimeout(stateTimer);
      if (!isError) {
        stateTimer = setTimeout(function () {
          stateEl.textContent = '자동 저장됩니다';
        }, 2000);
      }
    }

    /* ---------- 진행 상황 (자료 n / 3점 완성) ---------- */
    function cardState(card) {
      var parts = [
        card.querySelector('[data-photo]').getAttribute('src'),
        card.querySelector('[data-desc]').value.trim(),
        card.querySelector('[data-event]').value.trim()
      ];
      var n = parts.filter(Boolean).length;
      return n === parts.length ? 'done' : (n ? 'partial' : 'empty');
    }

    var STATE_TEXT = { done: '완성 ✓', partial: '작성 중', empty: '비어 있음' };

    function updateProgress() {
      var cards = grid.querySelectorAll('[data-card]');
      var done = 0;

      Array.prototype.forEach.call(cards, function (card) {
        var st = cardState(card);
        if (st === 'done') done++;
        var badge = card.querySelector('[data-card-status]');
        if (badge) {
          badge.textContent = STATE_TEXT[st];
          badge.className = 'card-status is-' + st;
        }
      });

      if (addLabel) addLabel.textContent = '빈 자료 카드 추가 (' + cards.length + ' / ' + MAX_CARDS + '장)';
      if (!progEl) return;

      progEl.querySelector('[data-progress-count]').textContent = done;
      progEl.classList.toggle('is-complete', done >= MAX_CARDS);
      progEl.querySelector('[data-progress-hint]').textContent = done >= MAX_CARDS
        ? '세 점을 모두 채웠습니다. 아래 ‘제출하러 가기’에서 선생님께 제출하세요.'
        : '자료 카드 세 장을 모두 채워야 합니다. 카드마다 사진 · 자료 설명 · 역사적 배경과 의미를 채우면 ‘완성’이 됩니다.';

      // 칸을 누르면 그 카드로 이동한다 (빈 자리는 카드를 새로 놓는다)
      var list = progEl.querySelector('[data-progress-steps]');
      list.textContent = '';
      for (var i = 0; i < MAX_CARDS; i++) {
        var card = cards[i];
        var st = card ? cardState(card) : 'missing';
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'progress-step is-' + st;
        var no = document.createElement('small');
        no.textContent = 'EXHIBIT 0' + (i + 1);
        var label = document.createElement('span');
        label.textContent = card ? STATE_TEXT[st] : '＋ 카드 놓기';
        btn.appendChild(no);
        btn.appendChild(label);
        btn.setAttribute('aria-label', (i + 1) + '번 자료 — ' + label.textContent);
        btn.addEventListener('click', card ? goTo.bind(null, card) : function () {
          if (addBtn) addBtn.click();
        });
        li.appendChild(btn);
        list.appendChild(li);
      }
    }

    function goTo(card) {
      var toggle = card.querySelector('[data-toggle]');
      if (toggle.getAttribute('aria-expanded') !== 'true') {
        setExpanded(card, toggle, card.querySelector('[data-card-body]'), true);
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---------- 저장 / 불러오기 ---------- */
    var saveTimer = null;

    function collect() {
      return Array.prototype.map.call(grid.querySelectorAll('[data-card]'), function (card) {
        return {
          photo: card.querySelector('[data-photo]').getAttribute('src') || '',
          desc: card.querySelector('[data-desc]').value,
          event: card.querySelector('[data-event]').value
        };
      });
    }

    // 실제로 저장한다. 저장 공간이 모자라면 false를 돌려준다.
    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collect()));
        // 로비의 작성 상태 표시를 갱신하도록 알린다
        document.dispatchEvent(new CustomEvent('exhibit:saved', { detail: { room: ROOM_ID } }));
        return true;
      } catch (err) {
        return false;
      }
    }

    // 글을 쓰는 동안에는 잠깐 모았다가 저장한다
    function save() {
      updateProgress();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        if (persist()) setState('저장됨 ✓');
        else setState('저장 공간이 부족합니다. 사진을 지우거나 용량이 작은 사진으로 바꿔 주세요.', true);
      }, 350);
    }

    function load() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    }

    /* ---------- textarea 자동 높이 ---------- */
    function autoGrow(el) { window.fitField(el); }   // main.js — 한 화면을 넘으면 칸 안에서 스크롤

    /* ---------- 이미지 축소 후 데이터 URL로 변환 ----------
       maxEdge · quality를 받아 두 번째 시도에서 더 세게 줄일 수 있게 한다 */
    function toDataURL(file, maxEdge, quality, done, fail) {
      if (!file || file.type.indexOf('image/') !== 0) {
        fail('이미지 파일만 첨부할 수 있습니다.');
        return;
      }

      var reader = new FileReader();
      reader.onerror = function () { fail('사진을 읽지 못했습니다.'); };
      reader.onload = function (e) {
        var img = new Image();
        // 원본을 그대로 쓰면 저장 용량을 넘기기 쉬워 축소 후 저장한다
        img.onerror = function () { done(e.target.result); };
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale);
          var h = Math.round(img.height * scale);

          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;

          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';           // 투명 PNG 대비
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          try {
            done(canvas.toDataURL('image/jpeg', quality));
          } catch (err) {
            done(e.target.result);
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    /* ---------- 사진 적용 / 해제 ---------- */
    function setPhoto(card, dataURL) {
      var photo = card.querySelector('[data-photo]');
      photo.src = dataURL;
      photo.hidden = false;
      card.classList.add('has-photo');
      card.querySelector('[data-photo-remove]').hidden = false;
      updateProgress();
    }

    function clearPhoto(card) {
      var photo = card.querySelector('[data-photo]');
      photo.removeAttribute('src');
      photo.hidden = true;
      card.classList.remove('has-photo');
      card.querySelector('[data-photo-remove]').hidden = true;
      card.querySelector('[data-file]').value = '';
      updateProgress();
    }

    /* 사진 첨부 — 저장까지 확인하고 끝낸다

       사진 세 장이 모두 들어가면 저장 공간(브라우저마다 5MB 안팎)에 닿을 수 있다.
       예전에는 저장에 실패해도 사진이 화면에 그대로 남아, 학생은 저장된 줄 알고 있다가
       새로고침하면 사라졌다. 이제는 ① 한 번 더 줄여 보고 ② 그래도 안 되면
       넣기 전으로 되돌려, 화면에 보이는 사진은 반드시 저장된 사진이 되게 한다. */
    function handleFile(card, file) {
      var previous = card.querySelector('[data-photo]').getAttribute('src') || '';

      function giveUp(msg) { setState(msg, true); }

      setState('사진을 넣는 중…');

      toDataURL(file, MAX_EDGE, JPEG_QUALITY, function (url) {
        setPhoto(card, url);
        if (persist()) { setState('저장됨 ✓'); return; }

        setState('사진이 커서 조금 더 줄이는 중…');

        toDataURL(file, RETRY_EDGE, RETRY_QUALITY, function (smaller) {
          setPhoto(card, smaller);
          if (persist()) { setState('사진을 더 줄여서 저장했습니다.'); return; }

          // 저장하지 못한 사진을 화면에 남기지 않는다
          if (previous) setPhoto(card, previous);
          else clearPhoto(card);
          card.querySelector('[data-file]').value = '';   // 같은 파일을 다시 고를 수 있게
          persist();

          giveUp('저장 공간이 부족해 이 사진은 넣지 못했습니다. ' +
                 '다른 사진을 지우거나 용량이 더 작은 사진으로 다시 시도해 주세요.');
        }, giveUp);
      }, giveUp);
    }

    /* ---------- 카드 만들기 ---------- */
    function createCard(data) {
      var card = tpl.content.firstElementChild.cloneNode(true);
      var fileInput = card.querySelector('[data-file]');
      var dropzone = card.querySelector('[data-dropzone]');
      var desc = card.querySelector('[data-desc]');
      var event = card.querySelector('[data-event]');

      // 저장된 내용 복원
      if (data) {
        if (data.photo) setPhoto(card, data.photo);
        desc.value = data.desc || '';
        event.value = data.event || '';
      }

      // 사진 선택
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) handleFile(card, fileInput.files[0]);
      });

      // 드래그앤드롭
      ['dragenter', 'dragover'].forEach(function (type) {
        dropzone.addEventListener(type, function (e) {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (type) {
        dropzone.addEventListener(type, function () {
          dropzone.classList.remove('is-dragover');
        });
      });
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(card, e.dataTransfer.files[0]);
        }
      });

      // 사진 삭제 (첨부 영역 위에 겹쳐 있어 파일 선택창이 함께 열리지 않도록 차단)
      card.querySelector('[data-photo-remove]').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        clearPhoto(card);
        save();
      });

      // 텍스트 입력
      [desc, event].forEach(function (ta) {
        ta.addEventListener('input', function () {
          autoGrow(ta);
          save();
        });
      });

      // 카드 삭제
      card.querySelector('[data-remove]').addEventListener('click', function () {
        if (!window.confirm('이 카드를 삭제할까요? 입력한 내용도 함께 지워집니다.')) return;
        card.remove();
        renumber();
        save();
      });

      // 펼치기 / 접기 — 접어도 머리글(번호)만은 항상 보인다
      var toggle = card.querySelector('[data-toggle]');
      var body = card.querySelector('[data-card-body]');
      toggle.addEventListener('click', function () {
        var expanded = toggle.getAttribute('aria-expanded') === 'true';
        setExpanded(card, toggle, body, !expanded);
      });

      return card;
    }

    function setExpanded(card, toggle, body, expanded) {
      toggle.setAttribute('aria-expanded', String(expanded));
      card.classList.toggle('is-collapsed', !expanded);
      body.hidden = !expanded;

      // 눌렀을 때 무슨 일이 일어날지 말로도 알려 준다
      var label = toggle.querySelector('[data-toggle-label]');
      if (label) label.textContent = expanded ? '접기' : '펼치기';

      // 숨어 있는 동안에는 scrollHeight를 잴 수 없어, 펼칠 때 다시 맞춘다
      if (expanded) {
        autoGrow(card.querySelector('[data-desc]'));
        autoGrow(card.querySelector('[data-event]'));
      }
    }

    /* ---------- 번호 다시 매기기 / 빈 상태 ---------- */
    function renumber() {
      var cards = grid.querySelectorAll('[data-card]');
      Array.prototype.forEach.call(cards, function (card, i) {
        var no = ('0' + (i + 1)).slice(-2);
        card.querySelector('[data-index]').textContent = 'EXHIBIT ' + no;
        card.querySelector('[data-remove]').setAttribute(
          'aria-label', no + '번 자료 카드 삭제');
      });

      // 정해진 수를 채우면 추가 버튼을 감춘다
      if (addBtn) addBtn.hidden = cards.length >= MAX_CARDS;

      var empty = grid.querySelector('.empty-state');
      if (cards.length === 0) {
        if (!empty) {
          empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = '‘＋ 자료 등록’을 눌러 시작하세요.';
          grid.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
      updateProgress();
    }

    function addCard(data, focusIt) {
      var card = createCard(data);
      grid.appendChild(card);
      renumber();

      // 높이를 잡으려면 DOM에 붙은 뒤에 계산해야 한다
      autoGrow(card.querySelector('[data-desc]'));
      autoGrow(card.querySelector('[data-event]'));

      if (focusIt) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.querySelector('[data-desc]').focus({ preventScroll: true });
      }
      return card;
    }

    /* ---------- 화면이 열릴 때 높이 다시 맞추기 ----------
       숨어 있는 동안에는 scrollHeight가 0이라 글칸 높이를 잴 수 없다.
       이 전시실이 화면에 나타나면 그때 다시 계산한다. */
    document.addEventListener('view:shown', function (e) {
      if (!e.detail || e.detail.view !== ROOM_ID) return;
      Array.prototype.forEach.call(
        grid.querySelectorAll('[data-desc], [data-event]'),
        function (ta) { autoGrow(ta); }
      );
    });

    /* ---------- 시작 ---------- */
    var saved = load();
    if (saved && saved.length) {
      saved.forEach(function (item) { addCard(item, false); });
    }
    // 예전에 한 장만 놓고 쓰던 학생도 세 장이 보이도록 빈 카드를 채워 둔다
    for (var i = grid.querySelectorAll('[data-card]').length; i < DEFAULT_CARDS; i++) addCard(null, false);
    renumber();

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (grid.querySelectorAll('[data-card]').length >= MAX_CARDS) return;
        addCard(null, true);
        save();
      });
    }
  }
})();
