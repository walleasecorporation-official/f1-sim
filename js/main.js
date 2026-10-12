/* =========================================================
   MAIN — 카메라 / 게임 루프 / 화면 흐름 / 적응형 해상도
========================================================= */
"use strict";

/* ---------------------------------------------------------
   CAMERA
--------------------------------------------------------- */
const CAMERA_MODES = ["CHASE", "ONBOARD", "T-CAM"];
let cameraMode = 0;
const camState = {yaw: 0, pos: new THREE.Vector3(), initialized: false, shake: 0};
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function toggleCamera(){
    cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
    hudEls.cameraMode.textContent = CAMERA_MODES[cameraMode];
    camState.initialized = false;
}

function carLocalToWorld(x, y, z, yaw, out){
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.set(car.position.x + x * c + z * s, car.position.y + y, car.position.z - x * s + z * c);
    return out;
}

function updateCamera(dt){
    const mode = CAMERA_MODES[cameraMode];
    const speedRatio = Math.min(1, Math.abs(physics.speed) / 90);

    driverHead.visible = mode !== "ONBOARD";

    // 노면 진동 (연석/잔디/벽 충돌)
    const rumble = (physics.onKerb ? .012 : 0) + (physics.surface === "grass" ? .02 : 0) + (physics.surface === "gravel" ? .035 : 0);
    camState.shake = rumble * Math.min(1, Math.abs(physics.speed) / 20) + physics.wallHit * .05
        + Math.min(.02, physics.porpoise * .08) + (physics.lockFront || physics.lockRear ? .01 : 0)
        + (physics.flatSpot[0] + physics.flatSpot[1]) * .002 * speedRatio;   // 플랫 스팟 진동
    const sx = (Math.random() - .5) * camState.shake;
    const sy = (Math.random() - .5) * camState.shake;

    if(mode === "CHASE"){
        // 카메라 yaw 가 차량 yaw 를 살짝 늦게 따라가 회전감이 살아난다.
        if(!camState.initialized){ camState.yaw = physics.yaw; }
        let d = physics.yaw - camState.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        camState.yaw += d * Math.min(1, dt * 6.5);

        const dist = 6.4 + speedRatio * .9;
        carLocalToWorld(0, 1.85 - speedRatio * .15, dist, camState.yaw, _v1);
        if(!camState.initialized){ camState.pos.copy(_v1); camState.initialized = true; }
        camState.pos.lerp(_v1, Math.min(1, dt * 12));
        camera.position.set(camState.pos.x + sx, camState.pos.y + sy, camState.pos.z);
        carLocalToWorld(0, .75, -3.5, camState.yaw, _v2);
        camera.lookAt(_v2);
    }else{
        const onboard = mode === "ONBOARD";
        carLocalToWorld(0, onboard ? .81 : 1.12, onboard ? -.14 : .12, physics.yaw, _v1);
        camera.position.set(_v1.x + sx * .5, _v1.y + sy * .5, _v1.z);
        carLocalToWorld(0, onboard ? .78 : .95, -40, physics.yaw, _v2);
        camera.lookAt(_v2);
        camState.initialized = false;
    }

    // 속도감: 고속에서 FOV 를 살짝 넓힌다.
    const targetFov = fovForAspect(BASE_FOV + speedRatio * 9, camera.aspect);
    if(Math.abs(camera.fov - targetFov) > .05){
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
        camera.updateProjectionMatrix();
    }
}

/** 시작 화면: 그리드 위 차량 주위를 천천히 도는 쇼케이스 카메라 */
let attractAngle = .6;
function updateAttractCamera(dt){
    attractAngle += dt * .18;
    const r = 7.5;
    camera.position.set(
        car.position.x + Math.sin(attractAngle) * r,
        1.6 + Math.sin(attractAngle * .7) * .4,
        car.position.z + Math.cos(attractAngle) * r
    );
    camera.lookAt(car.position.x, .5, car.position.z);
    driverHead.visible = true;
}

/* ---------------------------------------------------------
   RESIZE / ADAPTIVE RESOLUTION
--------------------------------------------------------- */
function onResize(){
    camera.aspect = innerWidth / innerHeight;
    camera.fov = fovForAspect(BASE_FOV, camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    prepareMinimap();
    drawMinimap();
    updateRotateHint();
}
window.addEventListener("resize", onResize);

const perf = {frames: 0, time: 0, good: 0, fps: 60};
function adaptResolution(dt){
    perf.frames++;
    perf.time += dt;
    if(perf.time < 1) return;
    perf.fps = perf.frames / perf.time;
    perf.frames = 0;
    perf.time = 0;
    if(typeof showFps !== "undefined" ? showFps : URL_PARAMS.has("fps")) hudEls.fps.textContent = Math.round(perf.fps) + " FPS · x" + currentPixelRatio.toFixed(2);

    const maxPr = Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio);
    let next = currentPixelRatio;
    if(perf.fps < 48 && currentPixelRatio > QUALITY.minPixelRatio){
        next = Math.max(QUALITY.minPixelRatio, currentPixelRatio - (perf.fps < 35 ? .2 : .1));
        perf.good = 0;
    }else if(perf.fps > 58){
        perf.good++;
        if(perf.good >= 4 && currentPixelRatio < maxPr){
            next = Math.min(maxPr, currentPixelRatio + .1);
            perf.good = 0;
        }
    }else{
        perf.good = 0;
    }
    if(Math.abs(next - currentPixelRatio) > .01){
        currentPixelRatio = next;
        renderer.setPixelRatio(currentPixelRatio);
        renderer.setSize(innerWidth, innerHeight);
    }
}

/* ---------------------------------------------------------
   SCREEN FLOW
--------------------------------------------------------- */
const ui = {
    start: document.getElementById("start"),
    pause: document.getElementById("pause"),
    finish: document.getElementById("finish"),
    startBtn: document.getElementById("startBtn"),
    resumeBtn: document.getElementById("resumeBtn"),
    restartBtn: document.getElementById("restartBtn"),
    againBtn: document.getElementById("againBtn"),
    results: document.getElementById("results"),
    mobileControls: document.getElementById("mobileControls"),
    tiltStatus: document.getElementById("tiltStatus"),
    qualitySelect: document.getElementById("qualitySelect"),
    sensSelect: document.getElementById("sensSelect"),
    rotateHint: document.getElementById("rotateHint")
};

let gameState = "menu";   // menu | playing | paused | finished
let lastTime = performance.now();
let lastMinimapDraw = 0;
let wakeLock = null;

let rotateHintTimer = 0;
function updateRotateHint(){
    if(!ui.rotateHint) return;
    const show = IS_MOBILE && gameState === "playing" && innerHeight > innerWidth;
    ui.rotateHint.classList.toggle("show", show);
    // 4초 뒤 자동으로 숨긴다 (세로로 계속 플레이해도 차를 가리지 않게)
    clearTimeout(rotateHintTimer);
    if(show) rotateHintTimer = setTimeout(() => ui.rotateHint.classList.remove("show"), 4000);
}

async function enterMobileMode(){
    // 1) 센서 권한 요청 — 반드시 클릭 직후 동기적으로 시작해야 한다 (iOS)
    const tiltPromise = enableTiltSteering();
    // 2) 전체 화면 + 가로 고정 (Android)
    const el = document.documentElement;
    try{
        if(el.requestFullscreen && !document.fullscreenElement){
            await el.requestFullscreen({navigationUI: "hide"});
        }
        if(screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape").catch(() => {});
    }catch(_){}
    // 3) 화면 꺼짐 방지
    try{
        if(navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    }catch(_){}

    const tiltOk = await tiltPromise;
    const preferButtons = typeof startUI !== "undefined" && startUI.steerMode === "buttons";
    setSteerMode(tiltOk && !preferButtons);
    if(preferButtons) showMessage("버튼 조향 모드 (설정에서 기울기로 바꿀 수 있어요)", 2.6);
    else if(!tiltOk) showMessage(tiltStatus === "insecure" ? "HTTPS 주소가 아니라 기울기 센서를 쓸 수 없어요 — 버튼 조향" : "기울기 센서를 쓸 수 없어 버튼 조향으로 전환했어요", 3.2);
    else showMessage("폰을 핸들처럼 기울여 조향하세요", 2.6);
}

/** 조향 방식 전환: true = 기울기, false = 화면 버튼 */
function setSteerMode(useTilt){
    Input.tiltActive = useTilt;
    Input.steer = 0;
    ui.mobileControls.classList.toggle("mode-tilt", useTilt);
    ui.mobileControls.classList.toggle("mode-buttons", !useTilt);
    // 버튼 조향 모드: 왼손 = ◀ ▶, 오른손 = BRAKE + THROTTLE
    const brake = document.getElementById("btnBrake");
    const throttle = document.getElementById("btnThrottle");
    if(!useTilt) throttle.parentNode.insertBefore(brake, throttle);
    else document.querySelector("#mobileControls .pad-left").appendChild(brake);
    if(useTilt) calibrateTilt();
}

let raceStarting = false;
async function startRace(){
    if(raceStarting) return;
    raceStarting = true;
    // 숨겨질 버튼에 포커스가 남아 Enter/Space 로 다시 눌리지 않도록
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    // 센서 권한 요청(iOS)은 클릭 직후 동기적으로 시작해야 하므로 await 전에 호출한다.
    const mobileReady = IS_MOBILE ? enterMobileMode() : null;
    ui.start.classList.add("hidden");
    ui.finish.classList.add("hidden");
    ui.pause.classList.add("hidden");
    gameState = "starting";
    Input.throttle = Input.brake = Input.boost = false;
    if(mobileReady){
        setTiltSensitivity(ui.sensSelect ? ui.sensSelect.value : "normal");
        try{ await mobileReady; }catch(_){}
        calibrateTilt();
    }
    setupGrid();
    resetRace();
    camState.initialized = false;
    gameState = "playing";
    document.body.classList.add("playing");
    updateRotateHint();
    lastTime = performance.now();
    raceStarting = false;
}

/** 시작 화면 설정을 반영하고 그리드에 차량을 세운다 (플레이어는 맨 뒤에서 출발) */
function setupGrid(){
    if(typeof applyStartScreenSettings === "function") applyStartScreenSettings();
    applyRaceSettingsToCar();
    hudEls.lapTotal.textContent = raceSettings.laps;
    const opponents = typeof initAICars === "function" ? raceSettings.opponents : 0;
    if(typeof initAICars === "function") initAICars(opponents);
    playerGridSlot = opponents;
    resetCar();
    if(typeof resetAICars === "function") resetAICars();
}

function pauseGame(){
    if(gameState !== "playing") return;
    gameState = "paused";
    ui.pause.classList.remove("hidden");
    if(typeof showPauseView === "function") showPauseView("main");
    Input.throttle = Input.brake = false;
    Input.boost = false;
}

/** 그래픽 품질 변경: 저장 후 새로고침 (장면을 다시 만들어야 하므로) */
function changeQuality(name){
    if(!QUALITY_PRESETS[name]) return;
    try{ localStorage.setItem(QUALITY_STORAGE_KEY, name); }catch(_){}
    const params = new URLSearchParams(location.search);
    params.delete("quality");
    const q = params.toString();
    location.href = location.pathname + (q ? "?" + q : "") + location.hash;
}

/** 시작 화면(메인 메뉴)으로 돌아가기 — 랩 수·타이어·상대 차량 등은 여기서 바꾼다 */
function goToMenu(){
    ui.pause.classList.add("hidden");
    ui.finish.classList.add("hidden");
    ui.start.classList.remove("hidden");
    gameState = "menu";
    document.body.classList.remove("playing");
    Input.throttle = Input.brake = Input.boost = false;
    setupGrid();
    race.state = "idle";
    setStartLights(0);
    camState.initialized = false;
    updateRotateHint();
}

function resumeGame(){
    if(gameState !== "paused") return;
    ui.pause.classList.add("hidden");
    gameState = "playing";
    calibrateTilt();
    lastTime = performance.now();
}

onRaceFinished = () => {
    gameState = "finished";
    if(typeof renderRaceResults === "function"){
        renderRaceResults(ui.results);
        setTimeout(() => ui.finish.classList.remove("hidden"), 600);
        return;
    }
    ui.results.innerHTML =
        "<div><span>TOTAL</span><b>" + formatTime(race.time) + "</b></div>" +
        "<div><span>BEST LAP</span><b>" + formatTime(race.bestLap) + "</b></div>" +
        "<div><span>LAST LAP</span><b>" + formatTime(race.lastLap) + "</b></div>";
    setTimeout(() => ui.finish.classList.remove("hidden"), 600);
};

ui.startBtn.addEventListener("click", startRace);
ui.resumeBtn.addEventListener("click", resumeGame);
// RESTART / 메인 메뉴 / 설정 버튼은 js/menu.js 에서 확인 단계와 함께 연결한다.
ui.againBtn.addEventListener("click", startRace);
const finishMenuBtn = document.getElementById("finishMenuBtn");
if(finishMenuBtn) finishMenuBtn.addEventListener("click", goToMenu);
const hudMenuBtn = document.getElementById("hudMenuBtn");
if(hudMenuBtn) hudMenuBtn.addEventListener("click", () => pauseGame());

if(ui.qualitySelect){
    ui.qualitySelect.value = QUALITY_NAME;
    ui.qualitySelect.addEventListener("change", () => changeQuality(ui.qualitySelect.value));
}

Input.onCameraToggle = toggleCamera;
Input.onAeroToggle = () => { if(gameState === "playing") toggleManualAero(); };

// 판정 지점에서 앞차와 1초 이내 → 오버테이크 모드 사용 가능
function onOverrideArmed(){
    if(gameState === "playing") showMessage(IS_MOBILE ? "OVERTAKE 가능 · BOOST 버튼" : "OVERTAKE 가능 · SHIFT 로 부스트", 1.8);
}
Input.onRecover = () => {
    if(gameState === "playing" && race.state === "racing"){
        recoverCarToTrack();
        camState.initialized = false;
    }
};
Input.onPause = () => { if(gameState === "playing") pauseGame(); else if(gameState === "paused") resumeGame(); };

document.addEventListener("visibilitychange", () => {
    if(document.hidden) pauseGame();
    else if(wakeLock === null && IS_MOBILE && navigator.wakeLock && gameState !== "menu"){
        navigator.wakeLock.request("screen").then(l => { wakeLock = l; }).catch(() => {});
    }
});

/* ---------------------------------------------------------
   GAME LOOP
--------------------------------------------------------- */
function frame(time){
    requestAnimationFrame(frame);
    const dt = Math.min(.033, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;

    if(gameState === "playing" || gameState === "finished"){
        updateInput(dt);
        const locked = updateRace(dt) || gameState === "finished";
        if(gameState === "finished"){
            Input.throttle = false;
        }
        if(typeof updateAICars === "function") updateAICars(dt, locked && race.state === "lights");
        updateCar(dt, locked);
        if(typeof resolveCarContacts === "function") resolveCarContacts();
        updateCarVisuals(dt, physics.speed, physics.steering, physics.brakePressure > .1 || locked);
        updateCamera(dt);
        updateHUD();
        if(time - lastMinimapDraw > 100){
            drawMinimap();
            lastMinimapDraw = time;
        }
    }else if(gameState === "menu"){
        updateAttractCamera(dt);
        if(typeof updateAICars === "function") updateAICars(0, true);
    }

    if(gameState !== "paused"){
        sky.position.copy(camera.position);
        sky.material.uniforms.time.value = time / 1000;
        updateSunFollow(car.position);
        renderer.render(scene, camera);
        adaptResolution(dt);
    }
}

/* ---------------------------------------------------------
   INITIAL
--------------------------------------------------------- */
setupGrid();
hudEls.cameraMode.textContent = CAMERA_MODES[cameraMode];
onResize();
updateHUD();
requestAnimationFrame(frame);
document.body.classList.add("ready");
