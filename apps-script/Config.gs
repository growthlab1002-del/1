/**
 * 점검 대시보드 설정.
 * 기준값을 바꾸고 싶으면 이 파일만 수정하면 됩니다.
 */
var CONFIG = {
  SPREADSHEET_ID: '1aJ819mZOgvkgD3hv_Gxbi78-7n5qMsCnY5fHE2H67XE',

  // 점검 대상 주문 탭 (사업자별)
  ORDER_TABS: ['토파지아', '브랜디코'],

  // 점검은 안 하지만 "이 주문번호가 시트에 있나?"를 볼 때 같이 찾는 과거 탭
  LOOKUP_ONLY_TABS: ['2025.02-06~매출정리'],

  // 기준값
  MISSING_ORDER_DAYS: 2,      // 1. 주문 후 며칠 지나도 발주 흔적이 없으면 누락
  NO_TRACKING_DAYS: 7,        // 3. 발주 후 며칠 지나도 송장이 없으면 자동취소 의심
  HOLD_WARN_DAYS: 3,          // 6. 체크 건 주황 표시
  HOLD_ALERT_DAYS: 5,         // 6. 체크 건 빨강 표시
  DEFAULT_PERIOD_DAYS: 60,    // 화면 기본 조회 기간
  RECENT_ROWS: 400,           // 누적 송장시트는 맨 아래(최근) 몇 행만 검사할지

  // A열 상태값 분류 (상태값에 이 글자가 들어 있으면 해당 분류)
  STATUS_HOLD: ['체크'],
  STATUS_CANCEL: ['취소', '반품', '환불', '교환'],
  STATUS_DONE: ['송장입력완료', '발송완료', '배송완료', '배송중', '구매확정', '출고완료'],

  // 송장 칸에 이 값이면 "송장 없음"으로 취급
  EMPTY_TRACKING_VALUES: ['미등록', '없음', '-'],

  // 주문 탭 열 찾기: 헤더 이름으로 찾습니다. (공백·줄바꿈 무시)
  //  exact: 정확히 같은 이름 / includes: 이 글자가 들어간 이름 / pos: 열 번호(1=A)
  //  last: 같은 이름이 여러 개면 마지막 것
  ORDER_COLUMNS: {
    status:      [{ pos: 1 }],
    memo:        [{ exact: '참고사항' }, { includes: '특이사항' }],
    orderDate:   [{ includes: '주문일자' }],
    channel:     [{ exact: '판매처' }],
    orderNo:     [{ exact: '주문번호' }],
    uniqueCode:  [{ includes: '고유코드' }],
    product:     [{ exact: '상품명' }],
    option:      [{ exact: '옵션명' }],
    qty:         [{ exact: '수량' }],
    buyer:       [{ exact: '구매인' }],
    source:      [{ exact: '구매처' }],
    payDate:     [{ exact: '결제날짜' }],
    overseasNo:  [{ includes: '주문번호/' }, { includes: '신청서번호' }],
    paidUsd:     [{ includes: '실결제액' }, { includes: '결제금액' }],
    cost:        [{ includes: '원가계' }],
    netProfit:   [{ exact: '순이익' }],
    marginRate:  [{ exact: '마진율', last: true }]
  },
  // 헤더가 "송장번호"로 시작하는 열은 모두 송장 칸으로 봅니다.
  TRACKING_HEADER_PREFIX: '송장번호',

  // 누적 송장시트 (헤더가 없거나 위치가 고정된 탭은 pos로 지정)
  UFREIGHT: {
    tab: '유프레이트 송장시트',
    orderNoPos: 6,      // F: 국내 주문번호
    trackingPos: 3,     // C: 송장번호
    qtyPos: 30,         // AD: 수량 (AC 단가 × AD 수량 = AE 금액)
    namePos: 16         // P: 수령인
  },
  ECO: {
    tab: '에코트랜스 송장시트',
    columns: {
      name:     [{ exact: '이름' }],
      tracking: [{ exact: '송장번호' }],
      appNo:    [{ exact: '신청서번호' }]
    }
  },
  SHIP_UPLOAD: {
    tab: '발송정보일괄등록',
    columns: {
      uniqueCode: [{ includes: '고유코드' }],
      tracking:   [{ exact: '송장번호' }],
      carrier:    [{ exact: '택배사' }]
    }
  },

  // 화면에서 "확인함" 처리한 항목을 기억하는 저장소 키 (시트는 수정하지 않음)
  DISMISS_KEY: 'dismissed_v1'
};
