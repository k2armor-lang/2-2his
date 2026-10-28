/* =========================================================
   근현대 전시전 — 제출 받기 (Google Apps Script 웹 앱)

   학생 사이트의 ‘선생님께 제출하기’ 버튼이 글과 사진을 보내면
   ① 구글 문서로 도록을 만들어 PDF로 바꾸고
   ② 선생님 드라이브의 제출 폴더에 학번_이름.pdf 로 저장한 뒤
   ③ 같은 폴더의 ‘제출 명단’ 시트에 한 줄을 남긴다.
   같은 학생이 다시 내면 지난 PDF는 휴지통으로 가고 새 PDF만 남는다.

   설치 방법은 README.md의 ‘선생님께 제출하기 설정’을 따른다.
   ========================================================= */

// 받을 폴더 — 비워 두면 내 드라이브에 FOLDER_NAME 폴더를 새로 만든다.
// 이미 있는 폴더로 받으려면 그 폴더 주소(https://drive.google.com/drive/folders/…)를 붙여 넣는다.
var FOLDER_URL = 'https://drive.google.com/drive/u/0/folders/1HtUufCwQ84WFq_kQLdQveoT-g43PpOR4';
var FOLDER_NAME = '2학기 한국사2 수행평가 - 근현대 전시전 기획하기';
var LOG_NAME = '제출 명단';
var TIME_ZONE = 'Asia/Seoul';

var MAX_ITEMS = 3;
var MAX_TEXT = 5000;                    // 글칸 하나의 최대 글자 수
var MAX_PHOTO_CHARS = 4 * 1024 * 1024;  // 사진 한 장(base64 글자 수) 상한

// 사이트 assets/js/export-pdf.js 의 ROOMS 와 짝을 맞춘다
var ROOMS = {
  room1: { no: '01', years: '1910 — 1945', title: '빼앗긴 들에도 봄은 오는가' },
  room2: { no: '02', years: '1945 — 1960', title: '광복, 그리고 다시 갈라진 땅' },
  room3: { no: '03', years: '1960 — 현재', title: '산업화와 민주화, 오늘의 우리' }
};

/* ---------- 처음 한 번 편집기에서 실행: 권한 허용 + 폴더·명단 만들기 ---------- */
function setup() {
  var folder = getFolder();
  var log = getLog(folder);
  Logger.log('제출 폴더: ' + folder.getUrl());
  Logger.log('제출 명단: ' + log.getParent().getUrl());
  // 문서·PDF 변환 권한도 여기서 함께 받아 둔다
  var probe = DocumentApp.create('권한 확인용 — 지워도 됩니다');
  DriveApp.getFileById(probe.getId()).setTrashed(true);
}

/* ---------- 주소가 살아 있는지 브라우저로 열어 확인할 때 ---------- */
function doGet() {
  return json({ ok: true, service: 'museum-submit' });
}

/* ---------- 제출 받기 ---------- */
function doPost(e) {
  try {
    var sub = validate(JSON.parse(e.postData.contents));
    var base = sub.sid + '_' + sub.name;
    var at = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');

    // 문서를 만들고 PDF로 바꾸는 일은 오래 걸리므로 잠금 밖에서 한다
    var pdf = buildPdf(sub, base, at);

    // 같은 이름 파일 바꾸기와 명단 기록은 한 번에 한 명씩
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var saved = store(sub, base, at, pdf);
      return json({ ok: true, file: base + '.pdf', at: at, count: saved.count });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 받은 내용 확인 (오류 문장은 학생 화면에 그대로 뜬다) ---------- */
function validate(d) {
  if (!d || typeof d !== 'object') throw new Error('제출 내용을 읽지 못했습니다.');

  var sid = String(d.sid || '').replace(/\s+/g, '');
  var name = String(d.name || '').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, '');
  if (!/^[0-9-]{2,12}$/.test(sid)) throw new Error('학번이 올바르지 않습니다.');
  if (!name || name.length > 20) throw new Error('이름이 올바르지 않습니다.');

  var room = ROOMS[d.room];
  if (!room) throw new Error('전시실 정보가 올바르지 않습니다.');

  var items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) throw new Error('등록된 자료가 없습니다.');
  if (items.length > MAX_ITEMS) throw new Error('자료는 ' + MAX_ITEMS + '점까지 낼 수 있습니다.');

  return {
    sid: sid,
    name: name,
    room: room,
    reason: text(d.reason),
    items: items.map(function (it) {
      it = it || {};
      return { photo: photo(it.photo), desc: text(it.desc), event: text(it.event) };
    })
  };
}

function text(v) {
  v = String(v == null ? '' : v).trim();
  if (v.length > MAX_TEXT) throw new Error('글이 너무 깁니다. 한 칸에 ' + MAX_TEXT + '자까지 쓸 수 있습니다.');
  return v;
}

function photo(v) {
  if (!v) return null;
  var m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+\/=]+)$/.exec(String(v));
  if (!m) throw new Error('사진 형식을 읽지 못했습니다. 사진을 다시 넣어 주세요.');
  if (m[2].length > MAX_PHOTO_CHARS) throw new Error('사진 용량이 너무 큽니다. 다른 사진으로 바꿔 주세요.');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'photo');
}

/* ---------- 도록 PDF 만들기 ---------- */
function buildPdf(sub, base, at) {
  var doc = DocumentApp.create(base);
  var body = doc.getBody();
  var H = DocumentApp.ParagraphHeading;

  body.setMarginTop(54).setMarginBottom(54).setMarginLeft(60).setMarginRight(60);

  var head = body.getParagraphs()[0];   // setText()는 값을 돌려주지 않아 이어 쓰지 않는다
  head.setText('EXHIBITION CATALOGUE');
  head.editAsText().setFontSize(9).setForegroundColor('#8a6d1f');
  body.appendParagraph('근현대 전시전 기획하기').setHeading(H.TITLE);
  body.appendParagraph('2026학년도 2학기 · 한국사2 수행평가').setHeading(H.SUBTITLE);

  var meta = body.appendTable([
    ['기획자', sub.sid + ' · ' + sub.name],
    ['전시실', 'Room ' + sub.room.no + ' · ' + sub.room.title],
    ['전시 시기', sub.room.years],
    ['전시 구성', '자료 ' + sub.items.length + '점'],
    ['제출 일시', at]
  ]);
  meta.setBorderColor('#cccccc');
  for (var r = 0; r < meta.getNumRows(); r++) {
    var cell = meta.getCell(r, 0);
    cell.setWidth(90);
    cell.setBackgroundColor('#f3f1ec');
    cell.editAsText().setBold(true);
  }

  body.appendParagraph('이 전시실을 선택한 이유').setHeading(H.HEADING2);
  para(body, sub.reason);

  sub.items.forEach(function (item, i) {
    body.appendPageBreak();
    body.appendParagraph('EXHIBIT ' + ('0' + (i + 1)).slice(-2)).setHeading(H.HEADING1);

    if (item.photo) {
      var img = body.appendImage(item.photo);
      var s = Math.min(1, 440 / img.getWidth(), 380 / img.getHeight());
      img.setWidth(Math.round(img.getWidth() * s)).setHeight(Math.round(img.getHeight() * s));
      img.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    } else {
      para(body, '', '(사진 없음)');
    }

    body.appendParagraph('자료 설명').setHeading(H.HEADING3);
    para(body, item.desc);
    body.appendParagraph('역사적 배경과 의미').setHeading(H.HEADING3);
    para(body, item.event);
  });

  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  var pdf = file.getAs(MimeType.PDF).setName(base + '.pdf');
  file.setTrashed(true);   // 중간 문서는 남기지 않는다
  return pdf;
}

function para(body, value, blank) {
  var p = body.appendParagraph(value || blank || '(작성되지 않음)');
  p.setLineSpacing(1.5);
  if (!value) p.editAsText().setForegroundColor('#999999');
  return p;
}

/* ---------- 저장 + 명단 기록 ---------- */
function store(sub, base, at, pdf) {
  var folder = getFolder();

  // 다시 낸 경우: 지난 제출본은 휴지통으로 (30일 동안은 되살릴 수 있다)
  var old = folder.getFilesByName(base + '.pdf');
  while (old.hasNext()) old.next().setTrashed(true);

  var file = folder.createFile(pdf);

  var sheet = getLog(folder);
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 2).getValues() : [];
  var count = 1;
  rows.forEach(function (row) {
    if (String(row[0]) === sub.sid && String(row[1]) === sub.name) count++;
  });

  var photos = sub.items.filter(function (it) { return it.photo; }).length;
  sheet.appendRow([
    at, sub.sid, sub.name,
    'Room ' + sub.room.no + ' · ' + sub.room.title,
    sub.items.length, photos, count, file.getUrl()
  ]);

  return { count: count };
}

/* ---------- 폴더 · 명단 찾기 (없으면 만든다) ---------- */
function getFolder() {
  var fixed = /folders\/([\w-]+)/.exec(FOLDER_URL);
  if (fixed) return DriveApp.getFolderById(fixed[1]);   // 주소가 틀리면 여기서 오류가 난다

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* 지워졌으면 새로 만든다 */ }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  props.deleteProperty('LOG_ID');
  return folder;
}

function getLog(folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LOG_ID');
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) return SpreadsheetApp.openById(id).getSheets()[0];
    } catch (err) { /* 새로 만든다 */ }
  }
  var created = SpreadsheetApp.create(LOG_NAME);
  DriveApp.getFileById(created.getId()).moveTo(folder);
  var sheet = created.getSheets()[0];
  sheet.getRange('B:B').setNumberFormat('@');   // 학번 앞의 0이 사라지지 않게
  sheet.appendRow(['제출 시각', '학번', '이름', '전시실', '자료 수', '사진 수', '제출 횟수', 'PDF']);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  props.setProperty('LOG_ID', created.getId());
  return sheet;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
