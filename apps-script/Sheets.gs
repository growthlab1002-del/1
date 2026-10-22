/**
 * 시트 읽기와 값 정리.
 * read* 함수만 SpreadsheetApp을 쓰고, 나머지는 순수 함수라 테스트에서 그대로 씁니다.
 */

function normalizeHeader(text) {
  return String(text == null ? '' : text).replace(/\s+/g, '');
}

/** 헤더 배열에서 spec 목록에 맞는 열 번호(0부터)를 찾습니다. 없으면 -1. */
function findColumn(headers, specs) {
  var norm = headers.map(normalizeHeader);
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    if (s.pos) return s.pos - 1;
    var hits = [];
    for (var c = 0; c < norm.length; c++) {
      if (s.exact && norm[c] === normalizeHeader(s.exact)) hits.push(c);
      else if (s.includes && norm[c].indexOf(normalizeHeader(s.includes)) !== -1) hits.push(c);
    }
    if (hits.length) return s.last ? hits[hits.length - 1] : hits[0];
  }
  return -1;
}

/** 첫 5행 중 "주문번호" 같은 기준 헤더가 있는 행을 헤더 행으로 봅니다. 없으면 -1. */
function findHeaderRow(values, specs) {
  for (var r = 0; r < Math.min(5, values.length); r++) {
    if (findColumn(values[r], specs) !== -1) return r;
  }
  return -1;
}

function cleanText(v) {
  return String(v == null ? '' : v).trim();
}

/** 주문번호·코드 비교용: 공백 제거, 대문자. */
function normId(v) {
  return cleanText(v).replace(/\s+/g, '').toUpperCase();
}

/** 한 칸에 여러 번호가 적혀 있을 때 나눕니다. ("U123 / U124", 줄바꿈 등) */
function splitIds(v) {
  return cleanText(v).split(/[\s,\/;]+/).map(normId).filter(function (x) { return x.length >= 4; });
}

/** "₩143,271", "-₩44,000", " - " 같은 표시값을 숫자로. 비었으면 null. */
function toNumber(v) {
  if (typeof v === 'number') return v;
  var s = cleanText(v);
  if (!s || s === '-') return null;
  var neg = /^-|^\(/.test(s);
  var digits = s.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  var n = parseFloat(digits);
  return neg ? -n : n;
}

/** 20260101 / "2026-01-01" / Date → Date(자정). 실패하면 null. */
function parseOrderDate(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var s = cleanText(v).replace(/[^0-9]/g, '');
  if (s.length < 8) return null;
  var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

/** 스마트스토어 주문번호처럼 앞 8자리가 날짜면 그 날짜. 아니면 null. */
function dateFromOrderNo(orderNo) {
  return parseOrderDate(normId(orderNo).slice(0, 8));
}

function hasValue(v) {
  return cleanText(v) !== '';
}

function isTrackingValue(v) {
  var s = cleanText(v);
  if (!s) return false;
  return CONFIG.EMPTY_TRACKING_VALUES.indexOf(s) === -1;
}

/** 시트 표시값(2차원 배열)을 주문 객체 배열로. */
function parseOrderTab(tabName, values) {
  var specs = CONFIG.ORDER_COLUMNS;
  var headerRow = findHeaderRow(values, specs.orderNo);
  if (headerRow === -1) throw new Error('[' + tabName + '] 탭에서 "주문번호" 헤더를 찾지 못했습니다.');
  var headers = values[headerRow];
  var col = {};
  Object.keys(specs).forEach(function (k) { col[k] = findColumn(headers, specs[k]); });
  var trackingCols = [];
  headers.forEach(function (h, i) {
    var n = normalizeHeader(h);
    if (n.indexOf(CONFIG.TRACKING_HEADER_PREFIX) === 0) trackingCols.push({ index: i, name: n });
  });

  var get = function (row, key) { return col[key] === -1 ? '' : cleanText(row[col[key]]); };
  var orders = [];
  for (var r = headerRow + 1; r < values.length; r++) {
    var row = values[r];
    var orderNo = get(row, 'orderNo');
    var uniqueCode = get(row, 'uniqueCode');
    if (!orderNo && !uniqueCode) continue;
    var trackings = [];
    trackingCols.forEach(function (tc) {
      if (isTrackingValue(row[tc.index])) trackings.push(normId(row[tc.index]));
    });
    orders.push({
      tab: tabName,
      rowNum: r + 1,
      status: get(row, 'status'),
      memo: get(row, 'memo'),
      orderDate: parseOrderDate(get(row, 'orderDate')),
      channel: get(row, 'channel'),
      orderNo: orderNo,
      uniqueCode: uniqueCode,
      product: get(row, 'product'),
      option: get(row, 'option'),
      qty: toNumber(get(row, 'qty')),
      buyer: get(row, 'buyer'),
      source: get(row, 'source'),
      payDate: get(row, 'payDate'),
      overseasNo: get(row, 'overseasNo'),
      paidUsd: toNumber(get(row, 'paidUsd')),
      cost: toNumber(get(row, 'cost')),
      netProfit: toNumber(get(row, 'netProfit')),
      marginRate: get(row, 'marginRate'),
      trackings: trackings
    });
  }
  return { orders: orders, missingColumns: Object.keys(col).filter(function (k) { return col[k] === -1; }) };
}

function parseUfreight(values) {
  var c = CONFIG.UFREIGHT;
  var rows = [];
  values.forEach(function (row, i) {
    var orderNo = normId(row[c.orderNoPos - 1]);
    if (!/^[0-9]{8,}$/.test(orderNo)) return; // 헤더나 빈 행 건너뜀
    rows.push({
      rowNum: i + 1,
      orderNo: orderNo,
      tracking: normId(row[c.trackingPos - 1]),
      qty: toNumber(row[c.qtyPos - 1]),
      name: cleanText(row[c.namePos - 1])
    });
  });
  return rows;
}

/** 헤더가 있는 일반 탭을 columns 설정대로 객체 배열로. */
function parseSimpleTab(tabName, values, columns) {
  var firstKey = Object.keys(columns)[0];
  var headerRow = -1;
  for (var r = 0; r < Math.min(5, values.length); r++) {
    var hit = Object.keys(columns).filter(function (k) { return findColumn(values[r], columns[k]) !== -1; });
    if (hit.length === Object.keys(columns).length) { headerRow = r; break; }
  }
  if (headerRow === -1) throw new Error('[' + tabName + '] 탭에서 헤더를 찾지 못했습니다.');
  var col = {};
  Object.keys(columns).forEach(function (k) { col[k] = findColumn(values[headerRow], columns[k]); });
  var rows = [];
  for (var i = headerRow + 1; i < values.length; i++) {
    var obj = { rowNum: i + 1 };
    Object.keys(col).forEach(function (k) { obj[k] = cleanText(values[i][col[k]]); });
    if (!obj[firstKey] && !obj.tracking) continue;
    rows.push(obj);
  }
  return rows;
}

/** 실제 시트에서 모든 데이터를 읽습니다. (읽기 전용) */
function readAllData() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var gids = {};
  var warnings = [];
  var read = function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { warnings.push('"' + name + '" 탭이 없습니다.'); return null; }
    gids[name] = sh.getSheetId();
    return sh.getDataRange().getDisplayValues();
  };

  var orders = [], lookupOrders = [];
  CONFIG.ORDER_TABS.forEach(function (name) {
    var v = read(name);
    if (!v) return;
    var parsed = parseOrderTab(name, v);
    if (parsed.missingColumns.length) warnings.push('[' + name + '] 못 찾은 열: ' + parsed.missingColumns.join(', '));
    orders = orders.concat(parsed.orders);
  });
  CONFIG.LOOKUP_ONLY_TABS.forEach(function (name) {
    var v = read(name);
    if (v) lookupOrders = lookupOrders.concat(parseOrderTab(name, v).orders);
  });

  var uf = read(CONFIG.UFREIGHT.tab);
  var eco = read(CONFIG.ECO.tab);
  var ship = read(CONFIG.SHIP_UPLOAD.tab);
  return {
    spreadsheetUrl: ss.getUrl(),
    gids: gids,
    warnings: warnings,
    orders: orders,
    lookupOrders: lookupOrders,
    ufreight: uf ? parseUfreight(uf) : [],
    eco: eco ? parseSimpleTab(CONFIG.ECO.tab, eco, CONFIG.ECO.columns) : [],
    shipUpload: ship ? parseSimpleTab(CONFIG.SHIP_UPLOAD.tab, ship, CONFIG.SHIP_UPLOAD.columns) : []
  };
}
