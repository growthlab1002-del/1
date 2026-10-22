// node apps-script/test/checks.test.js
// Apps Script 파일(.gs)을 그대로 불러와 점검 규칙을 샘플 데이터로 확인합니다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = vm.createContext({});
['Config.gs', 'Sheets.gs', 'Checks.gs'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
});
const g = (name) => vm.runInContext(name, ctx);

const TOPA_HEADERS = ['네이버 주문번호 20261', '참고사항', '주문일자\n(날짜만)', '판매처', '사업자명', '주문번호', '주문\n고유코드',
  '상품명', '옵션명', '수량', '구매인', '구매처', '결제날짜', '주문번호/신청서번호', '실결제액(US)', '원가계\n(A)',
  '송장번호_에코', '송장번호_유프', '송장번호_아마존', '순이익', '마진율', '마진율'];
// 토파지아 형식 행 만들기
function topa(o) {
  return [o.status || '', o.memo || '', o.date, '04.스마트스토어', '', o.no, o.code || o.no + 'C', o.product || '상품',
    '옵션', String(o.qty || 1), o.buyer || '홍길동', o.source || '', o.pay || '', o.overseas || '', o.usd || '',
    o.cost === undefined ? '₩10,000' : o.cost, o.eco || '미등록', o.uf || '미등록', o.amz || '', '1,000', '10%', o.margin || '5%'];
}

const TODAY = new Date(2026, 9, 22); // 2026-10-22

const topaRows = [
  TOPA_HEADERS,
  topa({ no: '2026101900000001', date: '20261019', status: '신규주문' }),                      // 1. 누락 (3일)
  topa({ no: '2026102100000002', date: '20261021', status: '신규주문' }),                      // 1일째 → 누락 아님
  topa({ no: '2026101900000003', date: '20261019', status: '체크', memo: '재고없음', margin: '-3%' }), // 6. 체크 (3일 warn)
  topa({ no: '2026101000000004', date: '20261010', status: '체크', memo: '역마진' }),          // 6. 체크 (12일 alert)
  topa({ no: '2026101000000005', date: '20261010', status: '신규주문', pay: '10/10', overseas: 'AE111' }), // 3. 송장 없음 12일
  topa({ no: '2026101500000006', date: '20261015', status: '주문취소', pay: '10/15', uf: '6077000001' }),   // 2b. 취소인데 송장
  topa({ no: '2026101800000007', date: '20261018', status: '신규주문', pay: '10/18', cost: '' }),           // 5. 원가 없음
  topa({ no: '2026101600000008', date: '20261016', status: '송장입력완료', pay: '10/16', qty: 2, uf: '6077000002' }), // 4. 수량 2 vs 1
  topa({ no: '2026101600000009', date: '20261016', status: '송장입력완료', pay: '10/16', overseas: 'U900', eco: '6099000001' }), // 정상
];

// 브랜디코: 헤더가 2행, 열 배치 다름
const brandiRows = [
  ['네이버', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '현지 정보', '', '', '', '', ''],
  ['', '특이사항메모', '주문일자\n(날짜만)', '판매처', '사업자명', '주문번호', '주문\n고유코드', '상품명', '옵션명', '수량',
    '구매인', '총결제액', '구매처', '결제날짜', '결제카드', '주문번호/택배사', '송장번호', '원가계\n(A)', '순이익', '마진율'],
  ['송장입력완료', '', '20261017', '06.쿠팡', '', '11100162450586', 'B1', '패딩', '블랙', '1', '김소희', '139000',
    '네이버', '10/17', '', '', '', '72900', '42,070', '30%'],
  ['', '', '20261017', '06.쿠팡', '', '11100162450587', 'B2', '패딩', '블랙', '1', '이세기', '139000',
    '', '', '', '', '', '', '', ''], // 1. 누락 (상태 빈칸 = 진행중)
];

// 유프레이트 송장시트: 헤더 없음. F=주문번호, C=송장, P=이름, AD=수량
function ufRow(orderNo, tracking, qty, name) {
  const r = new Array(40).fill('');
  r[2] = tracking; r[5] = orderNo; r[15] = name; r[29] = String(qty);
  return r;
}
const ufValues = [
  ufRow('2026101600000008', '6077000002', 1, '홍길동'),
  ufRow('2026101500000006', '6077000001', 1, '홍길동'),
  ufRow('2026101800009999', '6077000003', 1, '삭제된주문'),   // 2a. 시트에 없음
  ufRow('2025122081888691', '6077000004', 1, '옛날주문'),     // 기간 밖 → 무시
];

const ecoValues = [
  ['* 배대지 신청서 제출 후', '', ''],
  ['이름', '송장번호', '신청서번호'],
  ['홍길동', '6099000001', 'U900'],
  ['박취소', '6099000002', 'U901'],   // 2a. 시트에 없음
];
const shipValues = [
  ['주문고유코드', '송장번호', '택배사'],
  ['2026101600000009C', '6099000001', '우체국택배'],
  ['ZZZDELETED', '6099000003', '우체국택배'], // 2a. 시트에 없음
];

const data = {
  orders: g('parseOrderTab')('토파지아', topaRows).orders.concat(g('parseOrderTab')('브랜디코', brandiRows).orders),
  lookupOrders: [],
  ufreight: g('parseUfreight')(ufValues),
  eco: g('parseSimpleTab')('에코트랜스 송장시트', ecoValues, g('CONFIG').ECO.columns),
  shipUpload: g('parseSimpleTab')('발송정보일괄등록', shipValues, g('CONFIG').SHIP_UPLOAD.columns),
};

const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

// --- 파싱 ---
test('헤더 이름으로 열을 찾는다 (브랜디코 2행 헤더 포함)', () => {
  const t = g('parseOrderTab')('토파지아', topaRows);
  eq(t.missingColumns, []);
  const b = g('parseOrderTab')('브랜디코', brandiRows);
  assert.strictEqual(b.orders.length, 2);
  assert.strictEqual(b.orders[0].overseasNo, '');
  assert.strictEqual(b.orders[0].source, '네이버');
  assert.strictEqual(b.orders[0].cost, 72900);
});
test('같은 이름 열이 여러 개면 마지막 마진율을 쓴다', () => {
  const o = data.orders.find((x) => x.orderNo === '2026101900000003');
  assert.strictEqual(o.marginRate, '-3%');
});
test('"미등록" 송장은 송장 없음으로 본다', () => {
  const o = data.orders.find((x) => x.orderNo === '2026101900000001');
  eq(o.trackings, []);
});
test('금액 표시값을 숫자로 바꾼다', () => {
  assert.strictEqual(g('toNumber')('₩143,271'), 143271);
  assert.strictEqual(g('toNumber')('-₩44,000'), -44000);
  assert.strictEqual(g('toNumber')('  -  '), null);
  assert.strictEqual(g('toNumber')(''), null);
});
test('상태값을 분류한다', () => {
  const c = g('classifyStatus');
  assert.strictEqual(c('송장입력완료(자동)'), 'done');
  assert.strictEqual(c('체크'), 'hold');
  assert.strictEqual(c('주문취소'), 'cancel');
  assert.strictEqual(c('신규주문'), 'open');
  assert.strictEqual(c(''), 'open');
});
test('구매자명을 마스킹한다', () => {
  assert.strictEqual(g('maskName')('김소희'), '김*희');
  assert.strictEqual(g('maskName')('남궁민수'), '남**수');
  assert.strictEqual(g('maskName')('이세'), '이*');
});

// --- 점검 ---
const report = g('buildReport')(data, { today: TODAY });
const byId = Object.fromEntries(report.checks.map((c) => [c.id, c.items]));
const nos = (id) => byId[id].map((i) => i.orderNo).sort();

test('1. 해외 발주 누락: 2일 이상 + 발주 흔적 없음, 체크 건은 제외', () => {
  eq(nos('missing'), ['11100162450587', '2026101900000001']);
});
test('2. 취소했는데 발송됨: 취소 상태+송장, 그리고 배대지·발송 시트에만 있는 건', () => {
  eq(nos('cancelShipped'), ['2026101500000006', '2026101800009999', 'U901', 'ZZZDELETED']);
});
test('3. 해외 자동취소 의심: 발주 후 7일 넘게 송장 없음', () => {
  eq(nos('noTracking'), ['2026101000000005']);
});
test('4. 배대지 수량 불일치', () => {
  eq(nos('qtyMismatch'), ['2026101600000008']);
  assert.match(byId.qtyMismatch[0].reason, /2개 ≠ 유프레이트 1개/);
});
test('5. 원가 미입력', () => {
  eq(nos('noCost'), ['2026101800000007']);
});
test('6. 체크 건: 오래된 순, 3일 주황 / 5일 빨강', () => {
  eq(byId.hold.map((i) => [i.orderNo, i.ageDays, i.level]),
    [['2026101000000004', 12, 'alert'], ['2026101900000003', 3, 'warn']]);
  assert.strictEqual(byId.hold[1].reason, '재고없음');
});
test('사업자 필터', () => {
  const r = g('buildReport')(data, { today: TODAY, business: '브랜디코' });
  const missing = r.checks.find((c) => c.id === 'missing').items;
  eq(missing.map((i) => i.orderNo), ['11100162450587']);
  assert.strictEqual(r.checks.find((c) => c.id === 'hold').items.length, 0);
});
test('개인정보(전화·주소·통관번호)는 결과에 없다', () => {
  const json = JSON.stringify(report);
  assert.ok(!/010-|P\d{12}/.test(json));
  assert.ok(!json.includes('홍길동'));
});

console.log(`\n${passed}개 통과`);
