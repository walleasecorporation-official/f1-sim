/* =========================================================
   HUD / MINIMAP / LAP TIMING
   DOM 은 값이 바뀔 때만 갱신 (레이아웃 재계산 최소화)
========================================================= */
"use strict";

const TOTAL_LAPS = 3;

const hudEls = {
    lap: document.getElementById("lap"),
    lapTotal: document.getElementById("lapTotal"),
    lapTime: document.getElementById("lapTime"),
    lastLap: document.getElementById("lastLap"),
    bestLap: document.getElementById("bestLap"),
    speed: document.getElementById("speed"),
    gear: document.getElementById("gear"),
    rpmLeds: Array.from(document.querySelectorAll("#rpmLeds i")),
    cameraMode: document.getElementById("cameraMode"),
    surface: document.getElementById("surface"),
    sector: document.getElementById("sectorName"),
    message: document.getElementById("message"),
    fps: document.getElementById("fps"),
    tiltBar: document.getElementById("tiltIndicator")
};
hudEls.lapTotal.textContent = TOTAL_LAPS;

const hudCache = {};
function setText(key, el, value){
    if(hudCache[key] === value) return;
    hudCache[key] = value;
    el.textContent = value;
}

function formatTime(t){
    if(!isFinite(t) || t <= 0) return "--:--.---";
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(3);
}

/* ---------------------------------------------------------
   RACE / LAP STATE
--------------------------------------------------------- */
const race = {
    state: "idle",       // idle → lights → racing → finished
    lightsTimer: 0,
    lap: 1,
    lapStart: 0,
    time: 0,
    lastLap: 0,
    bestLap: 0,
    lastIndex: 0,
    checkpoints: 0,      // 1/3, 2/3 지점 통과 비트
    messageTimer: 0
};

function showMessage(text, duration = 2.2){
    hudEls.message.textContent = text;
    hudEls.message.classList.add("show");
    race.messageTimer = duration;
}

function resetRace(){
    race.state = "lights";
    race.lightsTimer = 0;
    race.lap = 1;
    race.time = 0;
    race.lapStart = 0;
    race.lastLap = 0;
    race.bestLap = 0;
    race.lastIndex = physics.trackIndex;
    race.checkpoints = 0;
    race.goDelay = .3 + Math.random() * .9;
    setStartLights(0);
}

/** 매 프레임. 반환값: 조작 잠금 여부 */
function updateRace(dt){
    if(race.messageTimer > 0){
        race.messageTimer -= dt;
        if(race.messageTimer <= 0) hudEls.message.classList.remove("show");
    }

    if(race.state === "lights"){
        // F1 스타트: 1초 간격으로 5개 점등 → 랜덤 지연 후 소등
        race.lightsTimer += dt;
        const lit = Math.min(5, Math.floor(race.lightsTimer / .8));
        setStartLights(lit);
        if(race.lightsTimer > 4.0 + (race.goDelay || 0)){
            setStartLights(0);
            race.state = "racing";
            race.time = 0;
            race.lapStart = 0;
            showMessage("GO!", 1.2);
        }
        return true;
    }

    if(race.state !== "racing") return false;

    race.time += dt;

    const i = physics.trackIndex;
    const n = SAMPLE_COUNT;
    if(i > n * .30 && i < n * .40) race.checkpoints |= 1;
    if(i > n * .63 && i < n * .73) race.checkpoints |= 2;

    // 결승선(인덱스 0) 통과
    const crossed = race.lastIndex > n * .9 && i < n * .1;
    if(crossed && race.checkpoints === 3){
        const lapTime = race.time - race.lapStart;
        race.lastLap = lapTime;
        const isBest = !race.bestLap || lapTime < race.bestLap;
        if(isBest) race.bestLap = lapTime;
        race.lapStart = race.time;
        race.checkpoints = 0;
        if(race.lap >= TOTAL_LAPS){
            race.state = "finished";
            onRaceFinished && onRaceFinished();
        }else{
            race.lap++;
            showMessage((race.lap === TOTAL_LAPS ? "FINAL LAP" : "LAP " + race.lap) + (isBest ? "  ·  BEST " + formatTime(lapTime) : ""));
        }
    }
    race.lastIndex = i;
    return false;
}

let onRaceFinished = null;

/* ---------------------------------------------------------
   HUD UPDATE
--------------------------------------------------------- */
let lastSectorName = "";

function sectorNameFor(index){
    // 가장 가까운 앞쪽 코너 이름
    let best = null, bestD = Infinity;
    for(const c of trackCorners){
        let d = c.index - index;
        if(d < -20) d += SAMPLE_COUNT;
        if(d >= -20 && d < bestD){ bestD = d; best = c; }
    }
    return best ? best.name : "";
}

function updateHUD(){
    setText("speed", hudEls.speed, String(Math.round(Math.abs(physics.speed) * 3.6)));
    setText("gear", hudEls.gear, physics.reverse ? "R" : physics.gear > 0 ? String(physics.gear) : "N");

    const rpmRatio = THREE.MathUtils.clamp((physics.engineRPM - physics.idleRPM) / (physics.engineMaxRPM - physics.idleRPM), 0, 1);
    const leds = Math.round(rpmRatio * hudEls.rpmLeds.length);
    if(hudCache.leds !== leds){
        hudCache.leds = leds;
        hudEls.rpmLeds.forEach((el, i) => el.classList.toggle("on", i < leds));
    }

    setText("lap", hudEls.lap, String(Math.min(race.lap, TOTAL_LAPS)));
    setText("lapTime", hudEls.lapTime, race.state === "racing" ? formatTime(race.time - race.lapStart) : race.state === "finished" ? formatTime(race.lastLap) : "0:00.000");
    setText("lastLap", hudEls.lastLap, formatTime(race.lastLap));
    setText("bestLap", hudEls.bestLap, formatTime(race.bestLap));

    const surf = physics.onKerb ? "KERB" : physics.surface === "asphalt" ? "DRY ASPHALT" : "GRASS";
    setText("surface", hudEls.surface, surf);
    if(hudCache.surfClass !== physics.surface){
        hudCache.surfClass = physics.surface;
        hudEls.surface.classList.toggle("warn", physics.surface === "grass");
    }

    const sec = sectorNameFor(physics.trackIndex);
    if(sec !== lastSectorName){
        lastSectorName = sec;
        setText("sector", hudEls.sector, "NEXT " + sec);
    }

    if(hudEls.tiltBar && Input.tiltActive){
        // 미터 폭(140px)의 절반 범위에서 좌우로 이동
        const v = Math.round(-Input.steer * 64);
        if(hudCache.tilt !== v){
            hudCache.tilt = v;
            hudEls.tiltBar.style.transform = "translateX(" + v + "px)";
        }
    }
}

/* ---------------------------------------------------------
   MINIMAP — 트랙은 한 번만 그려 두고 차량만 갱신
--------------------------------------------------------- */
const minimapCanvas = document.getElementById("minimap");
const minimapCtx = minimapCanvas.getContext("2d");
const minimapTrack = document.createElement("canvas");
let mapScale = 1, mapPad = 12, mapOffX = 0, mapOffY = 0;

function prepareMinimap(){
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = minimapCanvas.clientWidth || 150;
    const cssH = minimapCanvas.clientHeight || 150;
    minimapCanvas.width = minimapTrack.width = Math.round(cssW * dpr);
    minimapCanvas.height = minimapTrack.height = Math.round(cssH * dpr);
    const w = minimapCanvas.width, h = minimapCanvas.height;
    mapPad = 10 * dpr;
    const bw = trackBounds.maxX - trackBounds.minX, bh = trackBounds.maxZ - trackBounds.minZ;
    mapScale = Math.min((w - mapPad * 2) / bw, (h - mapPad * 2) / bh);
    mapOffX = (w - bw * mapScale) / 2;
    mapOffY = (h - bh * mapScale) / 2;

    const ctx = minimapTrack.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const path = () => {
        ctx.beginPath();
        for(let i = 0; i <= SAMPLE_COUNT; i += 2){
            const p = trackSamples[i % SAMPLE_COUNT];
            const x = (p.x - trackBounds.minX) * mapScale + mapOffX;
            const y = (p.z - trackBounds.minZ) * mapScale + mapOffY;
            if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
    };
    path();
    ctx.lineWidth = 6 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.stroke();
    path();
    ctx.lineWidth = 3.6 * dpr;
    ctx.strokeStyle = "#16191c";
    ctx.stroke();
    // 출발선
    const s0 = trackSamples[0];
    ctx.fillStyle = "#fff";
    ctx.fillRect((s0.x - trackBounds.minX) * mapScale + mapOffX - 2 * dpr, (s0.z - trackBounds.minZ) * mapScale + mapOffY - 5 * dpr, 4 * dpr, 10 * dpr);
}

function drawMinimap(){
    const ctx = minimapCtx;
    const w = minimapCanvas.width, h = minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(minimapTrack, 0, 0);
    const x = (car.position.x - trackBounds.minX) * mapScale + mapOffX;
    const y = (car.position.z - trackBounds.minZ) * mapScale + mapOffY;
    const dpr = w / (minimapCanvas.clientWidth || w);
    ctx.save();
    ctx.translate(x, y);
    // 화면 y 가 월드 z 와 같은 방향이므로 yaw 를 그대로 반전 적용
    ctx.rotate(-physics.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -7 * dpr);
    ctx.lineTo(4.5 * dpr, 6 * dpr);
    ctx.lineTo(0, 3.5 * dpr);
    ctx.lineTo(-4.5 * dpr, 6 * dpr);
    ctx.closePath();
    ctx.fillStyle = "#ff2a2a";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.2 * dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}
