/* =========================================================
   DEVICE / QUALITY CONFIG
   - 모바일/PC 판별
   - 그래픽 품질 프리셋 (?quality=low|medium|high 로 강제 가능)
========================================================= */
"use strict";

const URL_PARAMS = new URLSearchParams(location.search);

const IS_MOBILE = (() => {
    const forced = URL_PARAMS.get("mobile");
    if(forced !== null) return forced !== "0";
    const ua = navigator.userAgent;
    if(/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
    // iPadOS 13+ 는 Macintosh 로 표시된다.
    if(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
    // 마우스가 없는 터치 전용 기기
    return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
})();

const QUALITY_PRESETS = {
    low: {
        maxPixelRatio: 1.0,
        minPixelRatio: 0.6,
        antialias: false,
        shadows: false,
        shadowMapSize: 0,
        trees: 220,
        fogNear: 260,
        fogFar: 1500,
        anisotropy: 2,
        clouds: false,
        physicalPaint: false,
        catchFence: false,
        crowd: false
    },
    medium: {
        maxPixelRatio: 1.5,
        minPixelRatio: 0.7,
        antialias: false,
        shadows: false,
        shadowMapSize: 0,
        trees: 520,
        fogNear: 350,
        fogFar: 2100,
        anisotropy: 4,
        clouds: true,
        physicalPaint: false,
        catchFence: true,
        crowd: true
    },
    high: {
        maxPixelRatio: 2.0,
        minPixelRatio: 0.8,
        antialias: true,
        shadows: true,
        shadowMapSize: 2048,
        trees: 1100,
        fogNear: 450,
        fogFar: 2600,
        anisotropy: 8,
        clouds: true,
        physicalPaint: true,
        catchFence: true,
        crowd: true
    }
};

const QUALITY_NAME = (() => {
    const q = URL_PARAMS.get("quality");
    if(q && QUALITY_PRESETS[q]) return q;
    return IS_MOBILE ? "medium" : "high";
})();

const QUALITY = QUALITY_PRESETS[QUALITY_NAME];

document.documentElement.classList.add(IS_MOBILE ? "is-mobile" : "is-desktop");

/* ---------------------------------------------------------
   RACE SETTINGS (시작 화면에서 변경)
--------------------------------------------------------- */
const ASSIST_PRESETS = {
    // 초보: 트랙션 컨트롤 + ABS + 스핀 방지(ESP)
    beginner: {tc: true, abs: true, stability: true},
    // 보통: 트랙션 컨트롤 + ABS
    standard: {tc: true, abs: true, stability: false},
    // 프로: 실제 F1 규정과 동일하게 보조 장치 없음
    pro: {tc: false, abs: false, stability: false}
};

const raceSettings = {
    laps: 3,
    compound: "medium",                       // soft | medium | hard
    assists: IS_MOBILE ? "beginner" : "standard",
    aeroAuto: true,                           // 액티브 에어로 자동 전환
    opponents: IS_MOBILE ? 4 : 5
};

function currentAssists(){
    return ASSIST_PRESETS[raceSettings.assists] || ASSIST_PRESETS.standard;
}
