/* =========================================================
   PAUSE MENU — 일시정지 / 설정 / 조작법 / 다시 시작 / 메인 메뉴
   - PC: P · Esc 키 또는 화면 위쪽 ❚❚ MENU 버튼
   - 모바일: ❚❚ 버튼
   설정은 시작 화면 설정(startUI)과 같은 저장소에 기록된다.
========================================================= */
"use strict";

const pauseEls = {
    views: Array.from(document.querySelectorAll("#pause .pause-view")),
    settingsBtn: document.getElementById("settingsBtn"),
    helpBtn: document.getElementById("helpBtn"),
    restartBtn: document.getElementById("restartBtn"),
    menuBtn: document.getElementById("menuBtn"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmText: document.getElementById("confirmText"),
    confirmYes: document.getElementById("confirmYes"),
    camera: document.getElementById("setCamera"),
    assists: document.getElementById("setAssists"),
    aero: document.getElementById("setAero"),
    steer: document.getElementById("setSteer"),
    sens: document.getElementById("setSens"),
    fps: document.getElementById("setFps"),
    quality: document.getElementById("setQuality"),
    tiltText: document.getElementById("tiltStatusText"),
    tiltCalibrate: document.getElementById("tiltCalibrateBtn"),
    tiltRetry: document.getElementById("tiltRetryBtn")
};

let confirmAction = null;

function showPauseView(name){
    for(const v of pauseEls.views) v.hidden = v.dataset.view !== name;
    if(name === "settings") renderPauseSettings();
    // 첫 버튼에 포커스 (키보드 조작)
    const view = pauseEls.views.find(v => v.dataset.view === name);
    const first = view && view.querySelector("button");
    if(first && !IS_MOBILE) first.focus({preventScroll: true});
}

function askConfirm(title, text, action){
    pauseEls.confirmTitle.textContent = title;
    pauseEls.confirmText.textContent = text;
    confirmAction = action;
    showPauseView("confirm");
}

/* ---------------------------------------------------------
   설정 화면 상태 표시
--------------------------------------------------------- */
let showFps = URL_PARAMS.has("fps");

function renderPauseSettings(){
    markSegment(pauseEls.camera, String(cameraMode));
    markSegment(pauseEls.assists, raceSettings.assists);
    markSegment(pauseEls.aero, raceSettings.aeroAuto ? "auto" : "manual");
    markSegment(pauseEls.steer, Input.tiltActive ? "tilt" : "buttons");
    markSegment(pauseEls.sens, startUI.sens || "normal");
    markSegment(pauseEls.fps, showFps ? "on" : "off");
    markSegment(pauseEls.quality, QUALITY_NAME);
    if(pauseEls.tiltText){
        pauseEls.tiltText.textContent = Input.tiltActive ? "기울기 센서 동작 중 — 폰을 핸들처럼 돌려 조향하세요." : tiltStatusText();
    }
}

/** 시작 화면 설정과 동기화 후 저장 */
function commitSettings(){
    renderStartSettings();
    saveStartSettings();
    applyStartScreenSettings();
    renderPauseSettings();
}

function bindPauseSegment(group, onPick){
    if(!group) return;
    group.addEventListener("click", e => {
        const b = e.target.closest("button[data-v]");
        if(!b || !group.contains(b)) return;
        onPick(b.dataset.v);
        renderPauseSettings();
    });
}

bindPauseSegment(pauseEls.camera, v => {
    cameraMode = Math.max(0, Math.min(CAMERA_MODES.length - 1, parseInt(v, 10) || 0));
    hudEls.cameraMode.textContent = CAMERA_MODES[cameraMode];
    camState.initialized = false;
});

bindPauseSegment(pauseEls.assists, v => {
    if(!ASSIST_PRESETS[v]) return;
    startUI.assists = v;
    commitSettings();
});

bindPauseSegment(pauseEls.aero, v => {
    startUI.aeroAuto = v !== "manual";
    commitSettings();
});

bindPauseSegment(pauseEls.sens, v => {
    startUI.sens = v;
    if(startEls.sens) startEls.sens.value = v;
    setTiltSensitivity(v);
    saveStartSettings();
});

bindPauseSegment(pauseEls.steer, v => {
    startUI.steerMode = v;
    saveStartSettings();
    if(v === "buttons"){
        setSteerMode(false);
    }else if(tiltStatus === "active"){
        setSteerMode(true);
    }else{
        // 센서가 아직 확인되지 않았으면 이 클릭(사용자 제스처) 안에서 권한 요청
        retryTilt();
    }
});

bindPauseSegment(pauseEls.fps, v => {
    showFps = v === "on";
    hudEls.fps.textContent = "";
    hudEls.fps.hidden = !showFps;
});

bindPauseSegment(pauseEls.quality, v => {
    if(v === QUALITY_NAME || !QUALITY_PRESETS[v]) return;
    changeQuality(v);
});

async function retryTilt(){
    if(pauseEls.tiltText) pauseEls.tiltText.textContent = "기울기 센서를 확인하는 중…";
    const ok = await enableTiltSteering();
    if(ok){
        startUI.steerMode = "tilt";
        saveStartSettings();
    }
    setSteerMode(ok && startUI.steerMode !== "buttons");
    renderPauseSettings();
}

if(pauseEls.tiltRetry) pauseEls.tiltRetry.addEventListener("click", retryTilt);
if(pauseEls.tiltCalibrate) pauseEls.tiltCalibrate.addEventListener("click", () => {
    calibrateTilt();
    if(pauseEls.tiltText) pauseEls.tiltText.textContent = "지금 자세를 기울기 영점으로 맞췄어요.";
});

/* ---------------------------------------------------------
   메뉴 버튼
--------------------------------------------------------- */
pauseEls.settingsBtn.addEventListener("click", () => showPauseView("settings"));
pauseEls.helpBtn.addEventListener("click", () => showPauseView("help"));
pauseEls.restartBtn.addEventListener("click", () => {
    askConfirm("레이스를 다시 시작할까요?", "현재 레이스 기록은 사라지고 그리드에서 다시 출발합니다.", () => {
        ui.pause.classList.add("hidden");
        startRace();
    });
});
pauseEls.menuBtn.addEventListener("click", () => {
    askConfirm("메인 메뉴로 나갈까요?", "현재 레이스는 종료됩니다. 메인 메뉴에서 랩 수·타이어·상대 차량을 바꿀 수 있어요.", goToMenu);
});
pauseEls.confirmYes.addEventListener("click", () => {
    const action = confirmAction;
    confirmAction = null;
    if(action) action();
});
for(const b of document.querySelectorAll("#pause [data-back]")){
    b.addEventListener("click", () => showPauseView("main"));
}

// 일시정지 화면 바깥(어두운 영역)을 누르면 계속하기 — 단, 기본 메뉴일 때만
ui.pause.addEventListener("click", e => {
    if(e.target === ui.pause && !pauseEls.views[0].hidden) resumeGame();
});

// FPS 표시: 설정 값 반영 (adaptResolution 이 URL 옵션 대신 이 값을 본다)
hudEls.fps.hidden = !showFps;
