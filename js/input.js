/* =========================================================
   INPUT
   PC     : W 가속 / S 브레이크·후진 / A·D 조향 (방향키 동일)
   모바일 : 화면 가속·브레이크 페달 + 폰 기울기 조향
            (센서를 쓸 수 없으면 좌/우 터치 버튼으로 자동 대체)
========================================================= */
"use strict";

const Input = {
    throttle: false,
    brake: false,
    steer: 0,            // +1 = 왼쪽, -1 = 오른쪽
    boost: false,        // 오버테이크 모드 (Shift / BOOST 버튼, 누르고 있는 동안)
    tiltActive: false,
    tiltAngle: 0,        // 보정 후 기울기 (도)
    onCameraToggle: null,
    onAeroToggle: null,
    onRecover: null,
    onPause: null
};

/* ---------------------------------------------------------
   KEYBOARD (PC)
--------------------------------------------------------- */
const keyState = {};

function updateKeyboardAxes(){
    if(IS_MOBILE && !keyboardUsed) return;
    Input.throttle = !!(keyState.KeyW || keyState.ArrowUp);
    Input.brake = !!(keyState.KeyS || keyState.ArrowDown);
    const left = !!(keyState.KeyA || keyState.ArrowLeft);
    const right = !!(keyState.KeyD || keyState.ArrowRight);
    Input.steer = (left ? 1 : 0) - (right ? 1 : 0);
    Input.boost = !!(keyState.ShiftLeft || keyState.ShiftRight || keyState.Space) || touchBoost;
}

let keyboardUsed = !IS_MOBILE;

/** 레이스 화면인지 (메뉴의 버튼/선택 상자를 키보드로 조작할 때는 기본 동작을 막지 않는다) */
function inRaceView(){
    return typeof gameState !== "undefined" && (gameState === "playing" || gameState === "starting" || gameState === "finished");
}

window.addEventListener("keydown", e => {
    if(inRaceView()){
        if(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
        // 숨겨진 RACE START/RACE AGAIN 버튼에 포커스가 남아 Enter 로 레이스가 재시작되지 않도록
        if(e.code === "Enter" || e.code === "NumpadEnter") e.preventDefault();
    }
    if(e.repeat){ return; }
    keyboardUsed = true;
    keyState[e.code] = true;
    if(e.code === "KeyV" || e.code === "KeyC") Input.onCameraToggle && Input.onCameraToggle();
    if(e.code === "KeyR") Input.onRecover && Input.onRecover();
    if(e.code === "KeyE") Input.onAeroToggle && Input.onAeroToggle();
    if(e.code === "KeyP" || e.code === "Escape") Input.onPause && Input.onPause();
    updateKeyboardAxes();
});

window.addEventListener("keyup", e => {
    keyState[e.code] = false;
    updateKeyboardAxes();
});

// 창이 포커스를 잃으면 키가 눌린 채로 남지 않게 한다.
window.addEventListener("blur", () => {
    for(const k in keyState) keyState[k] = false;
    updateKeyboardAxes();
    Input.throttle = false;
    Input.brake = false;
    Input.boost = false;
    touchBoost = false;
    // 누르고 있던 터치 버튼도 모두 놓은 상태로 되돌린다
    for(const reset of holdButtonResets) reset();
    if(!Input.tiltActive) Input.steer = 0;
});

/* ---------------------------------------------------------
   TOUCH BUTTONS (모바일)
   pointer 이벤트 + pointerId 추적으로 멀티터치(가속+조향 동시) 지원
--------------------------------------------------------- */
const touchSteer = {left: false, right: false};
let touchBoost = false;

const holdButtonResets = [];

function bindHoldButton(el, onChange){
    if(!el) return;
    const active = new Set();
    holdButtonResets.push(() => { active.clear(); set(); });
    const set = () => {
        const on = active.size > 0;
        el.classList.toggle("pressed", on);
        onChange(on);
    };
    el.addEventListener("pointerdown", e => {
        e.preventDefault();
        active.add(e.pointerId);
        try{ el.setPointerCapture(e.pointerId); }catch(_){}
        if(navigator.vibrate) navigator.vibrate(8);
        set();
    });
    const release = e => { active.delete(e.pointerId); set(); };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el.addEventListener("contextmenu", e => e.preventDefault());
}

function bindTapButton(el, fn){
    if(!el) return;
    el.addEventListener("pointerdown", e => { e.preventDefault(); fn(); });
}

bindHoldButton(document.getElementById("btnThrottle"), on => { Input.throttle = on; });
bindHoldButton(document.getElementById("btnBrake"), on => { Input.brake = on; });
bindHoldButton(document.getElementById("btnLeft"), on => { touchSteer.left = on; });
bindHoldButton(document.getElementById("btnRight"), on => { touchSteer.right = on; });
bindHoldButton(document.getElementById("btnBoost"), on => { touchBoost = on; Input.boost = on; });
bindTapButton(document.getElementById("btnAero"), () => Input.onAeroToggle && Input.onAeroToggle());
bindTapButton(document.getElementById("btnCamera"), () => Input.onCameraToggle && Input.onCameraToggle());
bindTapButton(document.getElementById("btnRecover"), () => Input.onRecover && Input.onRecover());
bindTapButton(document.getElementById("btnCenter"), () => calibrateTilt());
bindTapButton(document.getElementById("btnPause"), () => Input.onPause && Input.onPause());

// 게임 화면에서 스크롤/확대/길게 누르기 메뉴 방지
document.addEventListener("touchmove", e => { if(e.target.closest("#game, #mobileControls")) e.preventDefault(); }, {passive: false});
document.addEventListener("gesturestart", e => e.preventDefault());
document.addEventListener("dblclick", e => e.preventDefault());

/* ---------------------------------------------------------
   TILT STEERING
   deviceorientation 의 beta/gamma 로 중력 방향을 복원한 뒤,
   현재 화면 방향(가로/세로) 기준으로 "핸들을 돌린 각도"를 계산한다.
   → 폰을 세우든 눕히든(뒤로 젖힌 각도와 무관하게) 같은 느낌으로 조향.
--------------------------------------------------------- */
const tilt = {
    raw: 0,
    offset: 0,
    filtered: 0,
    maxAngle: 28,     // 이 각도에서 최대 조향
    deadZone: 1.5,
    lastEvent: 0,
    calibrateNext: true
};

const TILT_SENSITIVITY = {low: 38, normal: 28, high: 20};

function setTiltSensitivity(name){
    tilt.maxAngle = TILT_SENSITIVITY[name] || 28;
}

function screenAngle(){
    if(screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
    if(typeof window.orientation === "number") return window.orientation;
    return 0;
}

function onDeviceOrientation(e){
    if(e.beta === null || e.gamma === null) return;
    const b = THREE.MathUtils.degToRad(e.beta);
    const g = THREE.MathUtils.degToRad(e.gamma);
    // 장치 좌표계에서의 중력(아래) 방향
    const gx = Math.sin(g) * Math.cos(b);
    const gy = -Math.sin(b);
    // 화면 좌표계로 회전
    const th = THREE.MathUtils.degToRad(screenAngle());
    const sx = gx * Math.cos(th) - gy * Math.sin(th);
    const sy = gx * Math.sin(th) + gy * Math.cos(th);
    // 폰이 거의 수평이면 회전각이 불안정하므로 이전 값을 유지
    if(Math.hypot(sx, sy) < .25) return;
    // 시계 방향(오른쪽)으로 돌리면 +
    tilt.raw = THREE.MathUtils.radToDeg(Math.atan2(sx, -sy));
    tilt.lastEvent = performance.now();
    if(tilt.calibrateNext){
        tilt.offset = tilt.raw;
        tilt.calibrateNext = false;
    }
}

function calibrateTilt(){
    tilt.calibrateNext = true;
    tilt.filtered = 0;
    if(navigator.vibrate) navigator.vibrate(20);
}

/*
   기울기 센서 상태 — 설정 메뉴에 이유를 보여 주기 위해 기록한다.
   active      : 동작 중
   insecure    : HTTPS 가 아닌 주소 (브라우저가 센서를 막음)
   denied      : 사용자가 권한을 거부 (iPhone)
   unsupported : 센서 API 없음 (PC 브라우저 등)
   no-data     : API 는 있지만 값이 들어오지 않음 (임베드 페이지, 센서 없음)
*/
let tiltStatus = "unknown";
let tiltListening = false;

function tiltStatusText(){
    switch(tiltStatus){
        case "active": return "기울기 센서 동작 중";
        case "insecure": return "HTTPS 주소가 아니라서 브라우저가 기울기 센서를 막았어요. https:// 로 시작하는 주소(GitHub Pages 등)로 접속하세요.";
        case "denied": return "동작 및 방향 권한이 거부됐어요. '기울기 다시 시도'를 누르고 허용을 선택하세요. (Safari: 설정 → Safari → 동작 및 방향 접근)";
        case "unsupported": return "이 기기/브라우저에는 기울기 센서가 없어요. 버튼 조향을 사용하세요.";
        case "no-data": return "센서 값이 들어오지 않아요. 다른 페이지 안에 띄운 경우 브라우저가 막았을 수 있어요. 게임 주소를 직접 열어 보세요.";
        default: return "아직 확인하지 않았어요. RACE START 를 누르면 확인합니다.";
    }
}

/** 사용자 제스처(버튼 클릭) 안에서 호출해야 iOS 권한 요청이 동작한다. */
async function enableTiltSteering(){
    if(typeof DeviceOrientationEvent === "undefined"){ tiltStatus = "unsupported"; return false; }
    if(window.isSecureContext === false){ tiltStatus = "insecure"; return false; }
    try{
        if(typeof DeviceOrientationEvent.requestPermission === "function"){
            const res = await DeviceOrientationEvent.requestPermission();
            if(res !== "granted"){ tiltStatus = "denied"; return false; }
        }
    }catch(err){
        tiltStatus = "denied";
        return false;
    }
    if(!tiltListening){
        window.addEventListener("deviceorientation", onDeviceOrientation);
        tiltListening = true;
    }
    calibrateTilt();
    // 실제 센서 값이 들어오는지 확인 (PC 브라우저/HTTP 환경 등은 이벤트가 없음)
    return new Promise(resolve => {
        const t0 = performance.now();
        const check = () => {
            if(tilt.lastEvent > t0){ tiltStatus = "active"; resolve(true); return; }
            if(performance.now() - t0 > 1500){ tiltStatus = "no-data"; resolve(false); return; }
            setTimeout(check, 100);
        };
        check();
    });
}

window.addEventListener("orientationchange", () => calibrateTilt());
if(screen.orientation) screen.orientation.addEventListener("change", () => calibrateTilt());

/** 매 프레임 호출: 모바일 조향 값 갱신 */
function updateInput(dt){
    if(!IS_MOBILE || keyboardUsed && !Input.tiltActive) return;

    if(Input.tiltActive){
        let a = tilt.raw - tilt.offset;
        a = Math.atan2(Math.sin(THREE.MathUtils.degToRad(a)), Math.cos(THREE.MathUtils.degToRad(a)));
        a = THREE.MathUtils.radToDeg(a);
        // 데드존 + 부드러운 응답 곡선
        const sign = Math.sign(a);
        let mag = Math.max(0, Math.abs(a) - tilt.deadZone) / (tilt.maxAngle - tilt.deadZone);
        mag = Math.min(1, mag);
        mag = mag * (.55 + .45 * mag);    // 중앙은 섬세하게, 끝은 빠르게
        const target = -sign * mag;       // 오른쪽 기울기 = 오른쪽 조향(-)
        // 센서 떨림 제거용 저역통과 필터
        tilt.filtered += (target - tilt.filtered) * Math.min(1, dt * 18);
        Input.tiltAngle = a;
        // 터치 조향 버튼이 눌려 있으면 그쪽이 우선
        const touch = (touchSteer.left ? 1 : 0) - (touchSteer.right ? 1 : 0);
        Input.steer = touch !== 0 ? touch : tilt.filtered;
    }else{
        Input.steer = (touchSteer.left ? 1 : 0) - (touchSteer.right ? 1 : 0);
    }
}
