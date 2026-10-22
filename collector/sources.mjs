import { pathToFileURL } from "node:url";

// 소스별 검색 URL과 Aside 에이전트에게 보낼 지시문.
// kind: "image" = 광고 이미지 레퍼런스, "video" = 영상 구조·기획 레퍼런스

const enc = encodeURIComponent;

export const SOURCES = {
  pinterest: {
    platform: "Pinterest", kind: "image", lang: "en",
    searchUrl: (q) => `https://www.pinterest.com/search/pins/?q=${enc(q)}`,
  },
  tvcf: {
    platform: "TVCF", kind: "video", lang: "ko",
    searchUrl: (q) => `https://www.tvcf.co.kr/search?keyword=${enc(q)}`,
  },
  sourcecreative: {
    platform: "Source Creative", kind: "video", lang: "en",
    searchUrl: (q) => `https://www.sourcecreative.com/search?q=${enc(q)}`,
  },
  frameset: {
    platform: "Frameset", kind: "video", lang: "en",
    searchUrl: (q) => `https://frameset.app/search?q=${enc(q)}`,
  },
  youtube: {
    platform: "YouTube", kind: "video", lang: "en",
    searchUrl: (q) => `https://www.youtube.com/results?search_query=${enc(q + " commercial")}`,
  },
  vimeo: {
    platform: "Vimeo", kind: "video", lang: "en",
    searchUrl: (q) => `https://vimeo.com/search?q=${enc(q + " commercial")}`,
  },
};

function productLine(brief) {
  const p = brief.product || {};
  return [
    `제품: ${p.name || "(이름 없음)"}`,
    p.description && `설명: ${p.description}`,
    `분야: ${[brief.category, brief.subcategory].filter(Boolean).join(" > ")}`,
    brief.keyVisual && `제품 비주얼: ${brief.keyVisual}`,
    (brief.mood || []).length && `무드: ${brief.mood.join(", ")}`,
    brief.targetAudience && `타깃: ${brief.targetAudience}`,
    (brief.adAngles || []).length && `광고 앵글: ${brief.adAngles.join(", ")}`,
  ].filter(Boolean).join("\n");
}

const IMAGE_SCHEMA = `[{"title": "핀 제목 또는 짧은 설명", "url": "핀 페이지 주소", "image": "원본 이미지 주소(https://i.pinimg.com/...)", "brand": "알 수 있으면 브랜드", "ratio": "1:1|4:5|9:16|16:9|2:3|기타", "hook": "이미지의 메인 카피나 핵심 연출 한 줄", "note": "이 제품 AI 광고에 어떻게 참고할지 한 줄", "tags": ["연출", "조명", "배경"], "relevance": 1-5}]`;

const VIDEO_SCHEMA = `[{"title": "영상 제목", "url": "영상 페이지 주소", "image": "썸네일 이미지 주소", "brand": "광고주/브랜드", "credits": "대행사·감독·프로덕션(보이면)", "duration": "0:30", "ratio": "16:9|9:16|1:1|기타", "hook": "첫 3초에 무엇을 보여 주는지", "scenes": ["씬1: ...", "씬2: ...", "씬3: ..."], "cta": "마지막 행동 유도 문구/장면", "note": "이 제품 AI 광고에 가져올 구조 포인트 한 줄", "tags": ["구성", "톤"], "relevance": 1-5}]`;

export function buildPrompt(sourceKey, query, brief, limit) {
  const s = SOURCES[sourceKey];
  const url = s.searchUrl(query);
  const isImage = s.kind === "image";
  return [
    `당신은 AI로 제품 광고를 만드는 팀의 레퍼런스 리서처입니다.`,
    ``,
    productLine(brief),
    ``,
    `할 일: ${url} 를 열고 검색 결과에서 이 제품의 ${isImage ? "광고 이미지(제품 연출·구도·조명·배경)" : "광고 영상 구조·기획"}에 참고할 만한 결과 ${limit}개를 고르세요.`,
    isImage
      ? `- 실제 제품 광고/제품 사진 연출 위주로, 단순 일러스트·밈·무관한 이미지는 빼세요.`
      : `- 각 영상 상세 페이지를 열어 설명·크레딧을 확인하고, 가능하면 영상을 훑어 첫 3초 훅, 씬 구성(3~6개), CTA를 정리하세요.`,
    `- 로그인 팝업이나 쿠키 배너는 닫고 진행하세요. 결과가 부족하면 비슷한 검색어로 한 번 더 찾아도 됩니다.`,
    `- relevance는 위 제품과 얼마나 맞는지 1~5점입니다.`,
    ``,
    `다른 말 없이 아래 형식의 JSON 배열만 출력하세요:`,
    isImage ? IMAGE_SCHEMA : VIDEO_SCHEMA,
  ].join("\n");
}

// 로컬 서버의 "Aside로 분석하기"에서 쓰는 제품 분석 지시문. 결과 형식은 대시보드의 cleanBrief()가 받는 모양과 같습니다.
export function analysisPrompt(product, photoPath) {
  const p = product || {};
  return [
    `당신은 AI로 제품 광고(AI 생성 이미지·영상)를 만드는 팀의 크리에이티브 디렉터입니다.`,
    photoPath
      ? `광고할 제품 사진이 이 컴퓨터에 있습니다: ${pathToFileURL(photoPath).href}\n브라우저에서 이 주소를 열어 제품 종류, 용기·소재, 색, 질감, 브랜드 표기를 확인하세요. 파일을 열 수 없으면 아래 정보만으로 진행하세요.`
      : ``,
    `제품 정보:`,
    `- 제품명: ${p.name || "(사진 참고)"}`,
    `- 설명: ${p.description || "-"}`,
    `- 타깃: ${p.target || "-"}`,
    `- 가격대·포지셔닝: ${p.price || "-"}`,
    ``,
    `필요하면 웹에서 이 분야의 유사 브랜드와 광고를 잠깐 찾아봐도 됩니다(5분 이내).`,
    `이 제품의 광고 레퍼런스를 찾기 위한 브리프를 만드세요. 검색어는 실제로 그 사이트에서 결과가 잘 나오는 짧은 표현으로 쓰고,`,
    `Pinterest는 제품 사진 연출(구도·조명·배경·소품) 위주, 영상 소스는 같은 분야의 광고 영상이 나오도록 쓰세요.`,
    `TVCF는 한국어, 나머지는 영어로 쓰세요. 경쟁·유사 브랜드 이름을 넣은 검색어도 섞으세요.`,
    ``,
    `다른 말 없이 이 JSON 객체만 출력하세요:`,
    `{"category": "대분류(예: 뷰티)", "subcategory": "소분류(예: 스킨케어 세럼)", "keyVisual": "제품 외형 한두 문장", "mood": ["무드 3~5개"],`,
    ` "targetAudience": "타깃 한 줄", "adAngles": ["광고 앵글 4~6개"], "aiAdIdeas": ["AI로 만들 컷 아이디어 3~5개, 장면·조명·카메라까지 구체적으로"],`,
    ` "competitorBrands": ["유사 브랜드 3~5개"],`,
    ` "queries": {"pinterest": ["3~4개"], "tvcf": ["3개"], "sourcecreative": ["2개"], "frameset": ["2개"], "youtube": ["3개"], "vimeo": ["2개"]}}`,
  ].filter((l) => l !== ``).join("\n");
}

// --mock 모드에서 Aside 대신 돌려줄 분석 결과
export function mockAnalysis(product) {
  const n = product?.name || "product";
  return {
    category: "뷰티", subcategory: "스킨케어", keyVisual: `${n} — 가짜 분석 결과(--mock)`, mood: ["clean", "fresh"],
    targetAudience: product?.target || "20~30대", adAngles: ["성분 클로즈업", "텍스처 시연"], aiAdIdeas: ["물방울이 맺힌 제품 위로 역광"],
    competitorBrands: ["Sample Brand"],
    queries: { pinterest: [`${n} product photography`], tvcf: [`${n} 광고`], sourcecreative: [`${n} commercial`],
      frameset: [`${n} product shot`], youtube: [`${n} commercial`], vimeo: [`${n} commercial`] },
  };
}
