/**
 * 점검 규칙. 모두 순수 함수입니다. (시트를 읽거나 쓰지 않음)
 */

var CHECKS = [
  { id: 'missing',       title: '해외 발주 누락',       kind: 'problem' },
  { id: 'cancelShipped', title: '취소했는데 발송됨',     kind: 'problem' },
  { id: 'noTracking',    title: '해외 자동취소 의심',    kind: 'problem' },
  { id: 'qtyMismatch',   title: '배대지 수량 불일치',    kind: 'problem' },
  { id: 'noCost',        title: '원가 미입력',          kind: 'problem' },
  { id: 'hold',          title: '체크(보류) 건',        kind: 'hold' }
];

function containsAny(text, words) {
  for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
  return false;
}

/** 상태값 → 'cancel' | 'hold' | 'done' | 'open' */
function classifyStatus(status) {
  var s = cleanText(status);
  if (containsAny(s, CONFIG.STATUS_CANCEL)) return 'cancel';
  if (containsAny(s, CONFIG.STATUS_HOLD)) return 'hold';
  if (containsAny(s, CONFIG.STATUS_DONE)) return 'done';
  return 'open';
}

function daysBetween(from, to) {
  if (!from) return null;
  var a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  var b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** 해외에 주문한 흔적이 있는가 (해외주문번호, 결제날짜, 송장 중 하나라도) */
function isOrderedOverseas(o) {
  return hasValue(o.overseasNo) || hasValue(o.payDate) || o.trackings.length > 0;
}

function maskName(name) {
  var s = cleanText(name);
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + new Array(s.length - 1).join('*') + s[s.length - 1];
}

function formatDate(d) {
  if (!d) return '';
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function orderItem(checkId, o, reason, extra) {
  var item = {
    key: checkId + '|' + o.tab + '|' + (o.orderNo || o.uniqueCode),
    tab: o.tab,
    rowNum: o.rowNum,
    status: o.status,
    channel: o.channel,
    orderDate: formatDate(o.orderDate),
    orderNo: o.orderNo,
    product: o.product,
    option: o.option,
    qty: o.qty,
    buyer: maskName(o.buyer),
    source: o.source,
    overseasNo: o.overseasNo,
    reason: reason
  };
  if (extra) Object.keys(extra).forEach(function (k) { item[k] = extra[k]; });
  return item;
}

function sheetItem(checkId, tab, rowNum, id, reason, extra) {
  var item = { key: checkId + '|' + tab + '|' + id, tab: tab, rowNum: rowNum, orderNo: id, reason: reason };
  if (extra) Object.keys(extra).forEach(function (k) { item[k] = extra[k]; });
  return item;
}

function recentRows(rows) {
  return rows.slice(Math.max(0, rows.length - CONFIG.RECENT_ROWS));
}

/**
 * 전체 점검 실행.
 * data: readAllData() 결과, opts: { today: Date, periodDays, business, channel }
 */
function buildReport(data, opts) {
  var today = opts.today || new Date();
  var periodDays = opts.periodDays || CONFIG.DEFAULT_PERIOD_DAYS;
  var inScope = function (o) {
    if (opts.business && o.tab !== opts.business) return false;
    if (opts.channel && o.channel.indexOf(opts.channel) === -1) return false;
    return true;
  };
  var inPeriod = function (d) {
    var age = daysBetween(d, today);
    return age !== null && age >= 0 && age <= periodDays;
  };

  var results = {};
  CHECKS.forEach(function (c) { results[c.id] = []; });
  var statusCounts = {};

  // 어떤 주문번호·코드·해외번호·송장이 시트에 있는지 색인
  var all = data.orders.concat(data.lookupOrders || []);
  var idx = { orderNo: {}, uniqueCode: {}, overseasNo: {}, tracking: {} };
  all.forEach(function (o) {
    if (o.orderNo) (idx.orderNo[normId(o.orderNo)] = idx.orderNo[normId(o.orderNo)] || []).push(o);
    if (o.uniqueCode) (idx.uniqueCode[normId(o.uniqueCode)] = idx.uniqueCode[normId(o.uniqueCode)] || []).push(o);
    splitIds(o.overseasNo).forEach(function (id) { (idx.overseasNo[id] = idx.overseasNo[id] || []).push(o); });
    o.trackings.forEach(function (t) { (idx.tracking[t] = idx.tracking[t] || []).push(o); });
  });

  // 배대지 쪽에 이 주문이 접수/발송됐는가
  var ufByOrder = {};
  (data.ufreight || []).forEach(function (u) { (ufByOrder[u.orderNo] = ufByOrder[u.orderNo] || []).push(u); });
  var shipByCode = {};
  (data.shipUpload || []).forEach(function (s) { shipByCode[normId(s.uniqueCode)] = s; });
  var ecoByApp = {};
  (data.eco || []).forEach(function (e) { if (e.appNo) ecoByApp[normId(e.appNo)] = e; });

  var shippedEvidence = function (o) {
    if (o.trackings.length) return '주문 시트에 송장 ' + o.trackings[0];
    if (ufByOrder[normId(o.orderNo)]) return '유프레이트 송장시트에 있음';
    if (o.uniqueCode && shipByCode[normId(o.uniqueCode)]) return '발송정보일괄등록에 송장 ' + shipByCode[normId(o.uniqueCode)].tracking;
    var eco = splitIds(o.overseasNo).filter(function (id) { return ecoByApp[id]; })[0];
    if (eco) return '에코트랜스 송장시트에 신청서 ' + eco;
    return null;
  };

  // ---- 주문 탭 기준 점검 ----
  var orderQty = {};
  data.orders.forEach(function (o) {
    statusCounts[o.tab + ' · ' + (o.status || '(빈칸)')] = (statusCounts[o.tab + ' · ' + (o.status || '(빈칸)')] || 0) + 1;
    if (!inScope(o)) return;
    var cls = classifyStatus(o.status);
    var age = daysBetween(o.orderDate, today);

    // 6. 체크(보류)
    if (cls === 'hold') {
      var level = age === null ? 'normal' : age >= CONFIG.HOLD_ALERT_DAYS ? 'alert' : age >= CONFIG.HOLD_WARN_DAYS ? 'warn' : 'normal';
      results.hold.push(orderItem('hold', o, o.memo || '메모 없음', {
        ageDays: age, level: level, marginRate: o.marginRate, netProfit: o.netProfit
      }));
      return;
    }
    if (!inPeriod(o.orderDate)) return;

    // 2b. 취소 상태인데 발송 흔적
    if (cls === 'cancel') {
      var ev = shippedEvidence(o);
      if (ev) results.cancelShipped.push(orderItem('cancelShipped', o, '상태 "' + o.status + '"인데 ' + ev));
      return;
    }

    var ordered = isOrderedOverseas(o);

    // 1. 발주 누락
    if (cls === 'open' && !ordered && age >= CONFIG.MISSING_ORDER_DAYS) {
      results.missing.push(orderItem('missing', o, '주문 ' + age + '일째 해외주문번호·결제날짜 없음', { ageDays: age }));
    }

    // 3. 송장이 안 생김 (자동취소 의심)
    if (cls !== 'done' && ordered && o.trackings.length === 0 && age >= CONFIG.NO_TRACKING_DAYS && !shippedEvidence(o)) {
      results.noTracking.push(orderItem('noTracking', o, '발주 후 ' + age + '일째 송장 없음 → ' + (o.source || '구매처') + ' 사이트에서 확인', { ageDays: age }));
    }

    // 5. 원가 미입력
    if (ordered && (o.cost === null || o.cost === 0)) {
      results.noCost.push(orderItem('noCost', o, '발주했는데 원가 비어 있음'));
    }

    var key = normId(o.orderNo);
    if (key) {
      orderQty[key] = orderQty[key] || { qty: 0, first: o };
      orderQty[key].qty += o.qty || 0;
    }
  });

  // 4. 배대지 수량 불일치 (유프레이트)
  Object.keys(orderQty).forEach(function (key) {
    var ufs = ufByOrder[key];
    if (!ufs) return;
    var ufQty = ufs.reduce(function (s, u) { return s + (u.qty || 0); }, 0);
    if (ufQty !== orderQty[key].qty) {
      results.qtyMismatch.push(orderItem('qtyMismatch', orderQty[key].first,
        '주문 수량 ' + orderQty[key].qty + '개 ≠ 유프레이트 ' + ufQty + '개'));
    }
  });

  // 2a. 배대지·발송 시트엔 있는데 주문 시트에 없음 (행 삭제 = 취소)
  if (!opts.business && !opts.channel) {
    var seen = {};
    (data.ufreight || []).forEach(function (u) {
      if (seen[u.orderNo]) return;
      seen[u.orderNo] = true;
      if (idx.orderNo[u.orderNo] || idx.tracking[u.tracking]) return;
      var d = dateFromOrderNo(u.orderNo);
      if (!inPeriod(d)) return;
      results.cancelShipped.push(sheetItem('cancelShipped', CONFIG.UFREIGHT.tab, u.rowNum, u.orderNo,
        '유프레이트에 접수됐는데 주문 시트에 없음 (삭제=취소?)', { orderDate: formatDate(d), buyer: maskName(u.name), tracking: u.tracking }));
    });
    recentRows(data.eco || []).forEach(function (e) {
      var app = normId(e.appNo);
      if (!app || idx.overseasNo[app] || idx.tracking[normId(e.tracking)]) return;
      results.cancelShipped.push(sheetItem('cancelShipped', CONFIG.ECO.tab, e.rowNum, app,
        '에코트랜스 신청서가 주문 시트에 없음 (삭제=취소?)', { buyer: maskName(e.name), tracking: e.tracking }));
    });
    recentRows(data.shipUpload || []).forEach(function (s) {
      var code = normId(s.uniqueCode);
      if (!code || idx.uniqueCode[code] || idx.tracking[normId(s.tracking)]) return;
      results.cancelShipped.push(sheetItem('cancelShipped', CONFIG.SHIP_UPLOAD.tab, s.rowNum, code,
        '송장 등록된 고유코드가 주문 시트에 없음 (삭제=취소?)', { tracking: s.tracking + ' ' + s.carrier }));
    });
  }

  results.hold.sort(function (a, b) { return (b.ageDays || 0) - (a.ageDays || 0); });
  ['missing', 'noTracking'].forEach(function (k) {
    results[k].sort(function (a, b) { return (b.ageDays || 0) - (a.ageDays || 0); });
  });

  return {
    generatedAt: today.toISOString(),
    periodDays: periodDays,
    checks: CHECKS.map(function (c) { return { id: c.id, title: c.title, kind: c.kind, items: results[c.id] }; }),
    statusCounts: statusCounts
  };
}
