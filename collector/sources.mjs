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
