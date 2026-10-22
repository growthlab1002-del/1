/**
 * 웹앱 진입점. 시트는 읽기만 하고, "확인함" 표시는 스크립트 저장소에 따로 보관합니다.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('주문 점검 대시보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDismissed_() {
  var raw = PropertiesService.getUserProperties().getProperty(CONFIG.DISMISS_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveDismissed_(map) {
  // 저장소 한 칸 용량(9KB)을 넘지 않도록 오래된 것부터 정리
  var keys = Object.keys(map).sort(function (a, b) { return map[a] < map[b] ? -1 : 1; });
  while (keys.length && JSON.stringify(map).length > 8500) delete map[keys.shift()];
  PropertiesService.getUserProperties().setProperty(CONFIG.DISMISS_KEY, JSON.stringify(map));
}

/** 화면에서 호출: 점검 결과 */
function getReport(filters) {
  filters = filters || {};
  var data = readAllData();
  var report = buildReport(data, {
    today: new Date(),
    periodDays: Number(filters.periodDays) || CONFIG.DEFAULT_PERIOD_DAYS,
    business: filters.business || '',
    channel: filters.channel || ''
  });

  var dismissed = getDismissed_();
  report.checks.forEach(function (c) {
    c.items.forEach(function (it) {
      var gid = data.gids[it.tab];
      it.link = data.spreadsheetUrl + '#gid=' + gid + '&range=A' + it.rowNum;
      it.dismissed = !!dismissed[it.key];
    });
  });

  var channels = {};
  data.orders.forEach(function (o) { if (o.channel) channels[o.channel] = true; });
  report.filters = { businesses: CONFIG.ORDER_TABS, channels: Object.keys(channels).sort() };
  report.warnings = data.warnings;
  return report;
}

/** 화면에서 호출: "확인함" 토글 */
function setDismissed(key, value) {
  var map = getDismissed_();
  if (value) map[key] = new Date().toISOString();
  else delete map[key];
  saveDismissed_(map);
  return true;
}
