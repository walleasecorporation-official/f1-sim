/* =========================================================
   HUD / MINIMAP / LAP TIMING / START SETTINGS / RESULTS
   DOM 은 값이 바뀔 때만 갱신 (레이아웃 재계산 최소화)
   ai.js(aiCars, getRaceStandings)가 없어도 동작하도록 모두 typeof 로 확인한다.
========================================================= */
"use strict";

// 총 랩 수는 시작 화면 설정(raceSettings.laps)을 따른다.

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
    tiltBar: document.getElementById("tiltIndicator"),

    /* 순위 */
    pos: document.getElementById("pos"),
    posTotal: document.getElementById("posTotal"),
    gap: document.getElementById("gap"),
    /* 타이어 / 연료 */
    tyreCompound: document.getElementById("tyreCompound"),
    tyres: ["tyreFL", "tyreFR", "tyreRL", "tyreRR"].map(id => document.getElementById(id)),
    fuel: document.getElementById("fuel"),
    /* ERS / 에어로 */
    ersFill: document.getElementById("ersFill"),
    ersState: document.getElementById("ersState"),
    otBadge: document.getElementById("otBadge"),
    aeroBadge: document.getElementById("aeroBadge"),
    /* 보조 장치 / 경고등 */
    lampTC: document.getElementById("lampTC"),
    lampABS: document.getElementById("lampABS"),
    lampESP: document.getElementById("lampESP"),
    warnLock: document.getElementById("warnLock"),
    warnSpin: document.getElementById("warnSpin"),
    infoTow: document.getElementById("infoTow"),
    infoDirty: document.getElementById("infoDirty"),
    /* 모바일 버튼 (상태 표시용) */
    mobileControls: document.getElementById("mobileControls"),
    btnBoost: document.getElementById("btnBoost"),
    btnAero: document.getElementById("btnAero")
};

const hudCache = {};
function setText(key, el, value){
    if(hudCache[key] === value) return;
    hudCache[key] = value;
    if(el) el.textContent = value;
}

/** 클래스 토글도 값이 바뀔 때만 */
function setClass(key, el, cls, on){
    if(hudCache[key] === on) return;
    hudCache[key] = on;
    if(el) el.classList.toggle(cls, on);
}

function formatTime(t){
    if(!isFinite(t) || t <= 0) return "--:--.---";
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(3);
}

function hasKey(obj, key){
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
}

/** 0xRRGGBB 숫자 / CSS 문자열 / THREE.Color → CSS 색 */
function cssColor(c, fallback){
    if(typeof c === "number" && isFinite(c)) return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6);
    if(typeof c === "string" && c) return c;
    if(c && c.isColor) return "#" + c.getHexString();
    return fallback || "#9aa1aa";
}

function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"})[ch]);
}

/* =========================================================
   START SCREEN SETTINGS — 시작 화면 설정
   버튼 상태(startUI) → applyStartScreenSettings() → raceSettings
   localStorage 에 저장해 두고 hud.js 로드 시점에 복원한다.
========================================================= */
const SETTINGS_KEY = "f1sim.settings.v1";
const LAP_OPTIONS = [3, 5, 10];
const MAX_OPPONENTS = 7;

const startUI = {
    laps: raceSettings.laps,
    compound: raceSettings.compound,
    assists: raceSettings.assists,
    aeroAuto: raceSettings.aeroAuto,
    opponents: raceSettings.opponents,
    sens: "normal"
};

const COMPOUND_HINTS = {
    soft: "소프트: 그립↑ · 마모·과열 빠름",
    medium: "미디엄: 그립과 수명의 균형",
    hard: "하드: 그립↓ · 오래 감 (예열 느림)"
};
const ASSIST_HINTS = {
    beginner: "TC + ABS + 스핀 방지(ESP) — 처음이라면 추천",
    standard: "TC + ABS — 뒤가 미끄러지면 직접 잡아야 해요",
    pro: "보조 없음 — 실제 F1과 동일 (락업·휠스핀 주의)"
};
const AERO_HINTS = {
    auto: "직선 구간에서 자동으로 X-MODE (저항↓ · 다운포스↓)",
    manual: IS_MOBILE ? "직선 구간에서 X-MODE 버튼으로 켬 (제동·조향 시 해제)" : "직선 구간에서 E 키로 X-MODE 켬 (제동·조향 시 해제)"
};

const startEls = {
    laps: document.getElementById("optLaps"),
    compound: document.getElementById("optCompound"),
    assists: document.getElementById("optAssists"),
    aero: document.getElementById("optAero"),
    opponents: document.getElementById("optOpponents"),
    oppValue: document.getElementById("valOpponents"),
    hintCompound: document.getElementById("hintCompound"),
    hintAssists: document.getElementById("hintAssists"),
    hintAero: document.getElementById("hintAero"),
    factLaps: document.getElementById("factLaps"),
    sens: document.getElementById("sensSelect")
};

function restoreStartSettings(){
    let saved = null;
    try{
        const raw = localStorage.getItem(SETTINGS_KEY);
        if(raw) saved = JSON.parse(raw);
    }catch(_){
        saved = null;
    }
    if(!saved || typeof saved !== "object") return;
    if(LAP_OPTIONS.indexOf(saved.laps) >= 0) startUI.laps = saved.laps;
    if(hasKey(TYRE_COMPOUNDS, saved.compound)) startUI.compound = saved.compound;
    if(hasKey(ASSIST_PRESETS, saved.assists)) startUI.assists = saved.assists;
    if(typeof saved.aeroAuto === "boolean") startUI.aeroAuto = saved.aeroAuto;
    if(Number.isInteger(saved.opponents) && saved.opponents >= 0 && saved.opponents <= MAX_OPPONENTS) startUI.opponents = saved.opponents;
    if(saved.sens === "low" || saved.sens === "normal" || saved.sens === "high") startUI.sens = saved.sens;
}

function saveStartSettings(){
    try{
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(startUI));
    }catch(_){}
}

function markSegment(group, value){
    if(!group) return;
    const buttons = group.querySelectorAll("button[data-v]");
    for(let i = 0; i < buttons.length; i++){
        const on = buttons[i].dataset.v === value;
        buttons[i].classList.toggle("on", on);
        buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
}

function renderStartSettings(){
    markSegment(startEls.laps, String(startUI.laps));
    markSegment(startEls.compound, startUI.compound);
    markSegment(startEls.assists, startUI.assists);
    markSegment(startEls.aero, startUI.aeroAuto ? "auto" : "manual");
    if(startEls.oppValue) startEls.oppValue.textContent = String(startUI.opponents);
    if(startEls.opponents){
        const steps = startEls.opponents.querySelectorAll("button[data-d]");
        for(let i = 0; i < steps.length; i++){
            const d = parseInt(steps[i].dataset.d, 10);
            steps[i].disabled = d < 0 ? startUI.opponents <= 0 : startUI.opponents >= MAX_OPPONENTS;
        }
    }
    if(startEls.hintCompound) startEls.hintCompound.textContent = COMPOUND_HINTS[startUI.compound] || "";
    if(startEls.hintAssists) startEls.hintAssists.textContent = ASSIST_HINTS[startUI.assists] || "";
    if(startEls.hintAero) startEls.hintAero.textContent = AERO_HINTS[startUI.aeroAuto ? "auto" : "manual"];
    if(startEls.factLaps) startEls.factLaps.textContent = String(startUI.laps);
    if(startEls.sens) startEls.sens.value = startUI.sens;
}

/** main.js 가 페이지 로드 시와 매 레이스 시작 시 호출: 시작 화면 값 → raceSettings */
function applyStartScreenSettings(){
    raceSettings.laps = startUI.laps;
    raceSettings.compound = startUI.compound;
    raceSettings.assists = startUI.assists;
    raceSettings.aeroAuto = startUI.aeroAuto;
    raceSettings.opponents = startUI.opponents;
    if(startEls.sens && startEls.sens.value) startUI.sens = startEls.sens.value;

    // 설정에 따라 달라지는 HUD / 모바일 버튼
    hudEls.lapTotal.textContent = raceSettings.laps;
    if(hudEls.mobileControls) hudEls.mobileControls.classList.toggle("aero-manual", !raceSettings.aeroAuto);
    const a = currentAssists();
    if(hudEls.lampTC) hudEls.lampTC.classList.toggle("na", !a.tc);
    if(hudEls.lampABS) hudEls.lampABS.classList.toggle("na", !a.abs);
    if(hudEls.lampESP) hudEls.lampESP.classList.toggle("na", !a.stability);
}

// 메뉴에서 설정을 바꾸면 그리드(상대 차량 수, 타이어 색)를 바로 다시 세운다.
let gridPreviewTimer = 0;
function scheduleGridPreview(){
    clearTimeout(gridPreviewTimer);
    gridPreviewTimer = setTimeout(() => {
        if(typeof setupGrid === "function" && typeof gameState !== "undefined" && gameState === "menu") setupGrid();
    }, 180);
}

function onStartSettingChanged(){
    renderStartSettings();
    saveStartSettings();
    applyStartScreenSettings();
    scheduleGridPreview();
}

function bindSegment(group, onPick){
    if(!group) return;
    group.addEventListener("click", e => {
        const b = e.target.closest("button[data-v]");
        if(!b || !group.contains(b)) return;
        onPick(b.dataset.v);
        onStartSettingChanged();
    });
}

bindSegment(startEls.laps, v => {
    const n = parseInt(v, 10);
    if(LAP_OPTIONS.indexOf(n) >= 0) startUI.laps = n;
});
bindSegment(startEls.compound, v => { if(hasKey(TYRE_COMPOUNDS, v)) startUI.compound = v; });
bindSegment(startEls.assists, v => { if(hasKey(ASSIST_PRESETS, v)) startUI.assists = v; });
bindSegment(startEls.aero, v => { startUI.aeroAuto = v !== "manual"; });

if(startEls.opponents){
    startEls.opponents.addEventListener("click", e => {
        const b = e.target.closest("button[data-d]");
        if(!b) return;
        const n = startUI.opponents + parseInt(b.dataset.d, 10);
        startUI.opponents = Math.max(0, Math.min(MAX_OPPONENTS, n));
        onStartSettingChanged();
    });
}
if(startEls.sens){
    startEls.sens.addEventListener("change", () => {
        startUI.sens = startEls.sens.value;
        saveStartSettings();
    });
}

// 타이어 칩 색 (컴파운드 색)
if(startEls.compound){
    const chips = startEls.compound.querySelectorAll("button[data-v]");
    for(let i = 0; i < chips.length; i++){
        const c = TYRE_COMPOUNDS[chips[i].dataset.v];
        if(c) chips[i].style.setProperty("--chip", c.color);
    }
}

restoreStartSettings();
renderStartSettings();
hudEls.lapTotal.textContent = startUI.laps;

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
    resultsState.container = null;
    standing.next = 0;
    standing.aheadKey = null;
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
    if(crossed) physicsOnNewLap();
    if(crossed && race.checkpoints === 3){
        const lapTime = race.time - race.lapStart;
        race.lastLap = lapTime;
        const isBest = !race.bestLap || lapTime < race.bestLap;
        if(isBest) race.bestLap = lapTime;
        race.lapStart = race.time;
        race.checkpoints = 0;
        if(race.lap >= raceSettings.laps){
            race.state = "finished";
            onRaceFinished && onRaceFinished();
        }else{
            race.lap++;
            showMessage((race.lap === raceSettings.laps ? "FINAL LAP" : "LAP " + race.lap) + (isBest ? "  ·  BEST " + formatTime(lapTime) : ""));
        }
    }
    race.lastIndex = i;
    return false;
}

let onRaceFinished = null;

/* =========================================================
   STANDINGS — 순위 / 앞차와의 간격 (초당 4회만 계산)
   ai.js 의 getRaceStandings() 항목: {isPlayer, code, color, progress, sortKey,
   finished, finishTime, bestLap, interval(s), gapToLeader(s), lapsDown}
   필드가 없으면 진행 거리 / 평균 속도로 추정한다.
========================================================= */
const standing = {
    next: 0,             // 다음 계산 시각 (performance.now)
    avgSpeed: 40,        // 최근 평균 속도 (m/s) — 거리 → 시간 환산용
    aheadKey: null,
    gapSmooth: 0
};

function safeStandings(){
    if(typeof getRaceStandings !== "function") return null;
    try{
        const list = getRaceStandings();
        return Array.isArray(list) ? list : null;
    }catch(_){
        return null;
    }
}

function entryIsPlayer(e){
    return !!e && (e === physics || e.isPlayer === true || e.car === physics || e.id === "player");
}

/** 순위 비교용 진행 거리 (sortKey 우선) */
function entryProgress(e){
    if(!e) return NaN;
    if(typeof e.sortKey === "number") return e.sortKey;
    if(typeof e.progress === "number") return e.progress;
    if(e.car && typeof e.car.progress === "number") return e.car.progress;
    return NaN;
}

function entryKey(e){
    return e.car || e.code || e.name || e;
}

function entryName(e){
    const src = e.car && typeof e.car === "object" ? e.car : e;
    return e.code || e.name || src.code || src.name || "CAR";
}

function entryColor(e){
    if(e.color !== undefined) return cssColor(e.color);
    if(e.car && e.car.color !== undefined) return cssColor(e.car.color);
    return cssColor(null);
}

/** 한 바퀴 이상 차이: "+1 LAP" / "+2 LAPS", 아니면 null */
function lapGapLabel(laps){
    if(!(laps >= 1)) return null;
    laps = Math.floor(laps);
    return "+" + laps + (laps > 1 ? " LAPS" : " LAP");
}

function refreshStandings(){
    standing.avgSpeed += (Math.max(0, physics.u) - standing.avgSpeed) * .08;
    let pos = 1, total = 1, gapText = "", close = false;
    let aheadProgress = NaN, aheadKey = null, myProgress = physics.progress, interval = NaN;

    const list = safeStandings();
    if(list && list.length){
        let pi = -1;
        for(let k = 0; k < list.length; k++){
            if(entryIsPlayer(list[k])){ pi = k; break; }
        }
        if(pi >= 0){
            total = list.length;
            const me = list[pi];
            if(isFinite(entryProgress(me))) myProgress = entryProgress(me);
            if(typeof me.interval === "number") interval = me.interval;
            if(pi > 0){ aheadProgress = entryProgress(list[pi - 1]); aheadKey = entryKey(list[pi - 1]); }
        }else{
            // 목록에 플레이어가 없으면 진행 거리로 끼워 넣는다
            total = list.length + 1;
            pi = 0;
            for(let k = 0; k < list.length; k++){
                const p = entryProgress(list[k]);
                if(p > physics.progress){
                    pi++;
                    if(!(p >= aheadProgress)){ aheadProgress = p; aheadKey = entryKey(list[k]); }
                }
            }
        }
        pos = pi + 1;
    }else if(typeof aiCars !== "undefined" && aiCars && aiCars.length){
        total = aiCars.length + 1;
        for(let k = 0; k < aiCars.length; k++){
            const p = aiCars[k].progress;
            if(p > physics.progress){
                pos++;
                if(!(p >= aheadProgress)){ aheadProgress = p; aheadKey = aiCars[k]; }
            }
        }
    }

    if(total > 1 && (race.state === "racing" || race.state === "finished")){
        if(pos === 1){
            gapText = "LEAD";
        }else if(isFinite(aheadProgress)){
            const lapLabel = lapGapLabel((aheadProgress - myProgress) / SAMPLE_COUNT);
            let s = interval;
            if(!isFinite(s)){
                // 추정: 거리 / 최근 평균 속도
                s = Math.max(0, aheadProgress - myProgress) * SAMPLE_SPACING / Math.max(20, standing.avgSpeed);
            }
            if(aheadKey !== standing.aheadKey){ standing.aheadKey = aheadKey; standing.gapSmooth = s; }
            else standing.gapSmooth += (s - standing.gapSmooth) * .5;
            if(lapLabel){
                gapText = lapLabel;
            }else{
                gapText = "+" + standing.gapSmooth.toFixed(1) + "s";
                close = standing.gapSmooth <= 1.0;
            }
        }
    }

    setText("pos", hudEls.pos, "P" + pos);
    setText("posTotal", hudEls.posTotal, String(total));
    setText("gap", hudEls.gap, gapText);
    setClass("gapClose", hudEls.gap, "close", close);
}

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

// 보조 장치 / 경고등은 깜빡임을 막기 위해 잠깐 유지
const lampHold = {tc: 0, abs: 0, esp: 0, lock: 0, spin: 0, deploy: 0, harvest: 0};
function lampOn(name, active, now, holdMs){
    if(active) lampHold[name] = now + holdMs;
    return active || now < lampHold[name];
}

const TYRE_TEMP_CLASS = ["tyre cold", "tyre ok", "tyre hot"];
const tyreTempCache = [-1, -1, -1, -1];
const tyreWearCache = [-1, -1, -1, -1];

function updateTyreHUD(){
    const comp = TYRE_COMPOUNDS[physics.compound] || TYRE_COMPOUNDS.medium;
    if(hudCache.compound !== physics.compound && hudEls.tyreCompound){
        hudCache.compound = physics.compound;
        hudEls.tyreCompound.textContent = comp.label.charAt(0);
        hudEls.tyreCompound.style.color = comp.color;
        hudEls.tyreCompound.style.borderColor = comp.color;
    }
    const lo = comp.optimum - comp.window / 2;
    const hi = comp.optimum + comp.window / 2;
    for(let i = 0; i < 4; i++){
        const el = hudEls.tyres[i];
        if(!el) continue;
        const t = physics.tyreTemp[i];
        const tc = t < lo ? 0 : t > hi ? 2 : 1;
        if(tyreTempCache[i] !== tc){
            tyreTempCache[i] = tc;
            el.className = TYRE_TEMP_CLASS[tc];
        }
        const w = Math.min(100, Math.round(physics.tyreWear[i] * 100));
        if(tyreWearCache[i] !== w){
            tyreWearCache[i] = w;
            el.textContent = w + "%";
        }
    }

    const f10 = Math.round(Math.max(0, physics.fuel) * 10);
    if(hudCache.fuel10 !== f10 && hudEls.fuel){
        hudCache.fuel10 = f10;
        hudEls.fuel.textContent = "FUEL " + (f10 / 10).toFixed(1) + " kg";
    }
    setClass("fuelLow", hudEls.fuel, "low", physics.fuel < .6);
}

function updatePowerHUD(now){
    // ERS 배터리 (0.5% 단위로만 갱신)
    const ersQ = Math.round(THREE.MathUtils.clamp(physics.ersEnergy / POWER_UNIT.esCapacity, 0, 1) * 200);
    if(hudCache.ersQ !== ersQ && hudEls.ersFill){
        hudCache.ersQ = ersQ;
        hudEls.ersFill.style.transform = "scaleX(" + (ersQ / 200) + ")";
    }
    setClass("ersLow", hudEls.ersFill, "low", ersQ < 30);
    setClass("ersOT", hudEls.ersFill, "ot", physics.overrideActive);

    const deploy = lampOn("deploy", physics.ersDeployKW > 5 && physics.ersEnergy > 0, now, 150);
    const harvest = lampOn("harvest", physics.ersHarvestKW > 5, now, 150);
    const st = deploy ? "DEPLOY" : harvest ? "HARVEST" : "";
    if(hudCache.ersState !== st && hudEls.ersState){
        hudCache.ersState = st;
        hudEls.ersState.textContent = st;
        hudEls.ersState.className = st === "DEPLOY" ? "deploy" : st === "HARVEST" ? "harvest" : "";
    }

    // 오버테이크: 0 = 사용 불가, 1 = 사용 가능, 2 = 사용 중
    const ot = physics.overrideActive ? 2 : physics.overrideArmed ? 1 : 0;
    if(hudCache.ot !== ot){
        hudCache.ot = ot;
        for(const el of [hudEls.otBadge, hudEls.btnBoost]){
            if(!el) continue;
            el.classList.toggle("armed", ot === 1);
            el.classList.toggle("active", ot === 2);
        }
    }

    // 액티브 에어로: 0 = Z, 1 = X 가능(수동), 2 = X
    const isX = physics.aeroMode === "X";
    const aero = isX ? 2 : (!raceSettings.aeroAuto && physics.inAeroZone) ? 1 : 0;
    if(hudCache.aero !== aero){
        hudCache.aero = aero;
        if(hudEls.aeroBadge){
            hudEls.aeroBadge.textContent = aero === 2 ? "X-MODE" : aero === 1 ? "X 가능" : "Z-MODE";
            hudEls.aeroBadge.classList.toggle("x", aero === 2);
            hudEls.aeroBadge.classList.toggle("avail", aero === 1);
        }
        if(hudEls.btnAero){
            hudEls.btnAero.classList.toggle("on", aero === 2);
            hudEls.btnAero.classList.toggle("avail", aero === 1);
        }
    }
}

function updateLampHUD(now){
    setClass("lampTC", hudEls.lampTC, "on", lampOn("tc", physics.tcActive, now, 250));
    setClass("lampABS", hudEls.lampABS, "on", lampOn("abs", physics.absActive, now, 250));
    setClass("lampESP", hudEls.lampESP, "on", lampOn("esp", physics.escActive, now, 250));
    setClass("warnLock", hudEls.warnLock, "on", lampOn("lock", physics.lockFront || physics.lockRear, now, 400));
    setClass("warnSpin", hudEls.warnSpin, "on", lampOn("spin", physics.wheelspin, now, 400));
    setClass("infoTow", hudEls.infoTow, "on", physics.slipstream > .25);
    setClass("infoDirty", hudEls.infoDirty, "on", physics.dirtyAir > .3);
}

function updateHUD(){
    const now = performance.now();

    setText("speed", hudEls.speed, String(Math.round(Math.abs(physics.speed) * 3.6)));
    setText("gear", hudEls.gear, physics.reverse ? "R" : physics.gear > 0 ? String(physics.gear) : "N");

    const rpmRatio = THREE.MathUtils.clamp((physics.engineRPM - physics.idleRPM) / (physics.engineMaxRPM - physics.idleRPM), 0, 1);
    const leds = Math.round(rpmRatio * hudEls.rpmLeds.length);
    if(hudCache.leds !== leds){
        hudCache.leds = leds;
        hudEls.rpmLeds.forEach((el, i) => el.classList.toggle("on", i < leds));
    }

    setText("lap", hudEls.lap, String(Math.min(race.lap, raceSettings.laps)));
    setText("lapTime", hudEls.lapTime, race.state === "racing" ? formatTime(race.time - race.lapStart) : race.state === "finished" ? formatTime(race.lastLap) : "0:00.000");
    setText("lastLap", hudEls.lastLap, formatTime(race.lastLap));
    setText("bestLap", hudEls.bestLap, formatTime(race.bestLap));

    const surfInfo = typeof SURFACES !== "undefined" ? SURFACES[physics.surface] : null;
    setText("surface", hudEls.surface, surfInfo ? surfInfo.label : physics.onKerb ? "KERB" : physics.surface === "asphalt" ? "DRY ASPHALT" : "GRASS");
    setClass("surfWarn", hudEls.surface, "warn", physics.surface === "grass" || physics.surface === "gravel");

    const sec = sectorNameFor(physics.trackIndex);
    if(sec !== lastSectorName){
        lastSectorName = sec;
        setText("sector", hudEls.sector, "NEXT " + sec);
    }

    if(now >= standing.next){
        standing.next = now + 250;
        refreshStandings();
    }
    updatePowerHUD(now);
    updateTyreHUD();
    updateLampHUD(now);

    // 결승 후 결과표는 1초마다 갱신 (AI 가 결승선을 통과하면 기록이 채워진다)
    if(race.state === "finished" && resultsState.container && now >= resultsState.next){
        resultsState.next = now + 1000;
        buildRaceResults();
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

    // 액티브 에어로(X-MODE) 허용 직선 구간 — 초록색
    if(typeof aeroZones !== "undefined"){
        ctx.lineWidth = 2.4 * dpr;
        ctx.strokeStyle = "#27e07a";
        for(const zone of aeroZones){
            ctx.beginPath();
            for(let j = 0; j <= zone.length; j += 2){
                const p = trackSamples[(zone.start + Math.min(j, zone.length)) % SAMPLE_COUNT];
                const x = (p.x - trackBounds.minX) * mapScale + mapOffX;
                const y = (p.z - trackBounds.minZ) * mapScale + mapOffY;
                if(j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    // 출발선
    const s0 = trackSamples[0];
    ctx.fillStyle = "#fff";
    ctx.fillRect((s0.x - trackBounds.minX) * mapScale + mapOffX - 2 * dpr, (s0.z - trackBounds.minZ) * mapScale + mapOffY - 5 * dpr, 4 * dpr, 10 * dpr);
}

// AI 차량 색 문자열 캐시 (매번 변환하지 않도록)
const aiColorSrc = [];
const aiColorCss = [];

function aiCarX(c){
    if(typeof c.x === "number") return c.x;
    const m = c.mesh || c.group || c.object;
    return m && m.position ? m.position.x : NaN;
}
function aiCarZ(c){
    if(typeof c.z === "number") return c.z;
    const m = c.mesh || c.group || c.object;
    return m && m.position ? m.position.z : NaN;
}

function drawMinimap(){
    const ctx = minimapCtx;
    const w = minimapCanvas.width, h = minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(minimapTrack, 0, 0);
    const dpr = w / (minimapCanvas.clientWidth || w);

    // AI 차량: 작은 점
    if(typeof aiCars !== "undefined" && aiCars && aiCars.length){
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = "rgba(0,0,0,.75)";
        for(let i = 0; i < aiCars.length; i++){
            const c = aiCars[i];
            if(!c) continue;
            const cx = aiCarX(c), cz = aiCarZ(c);
            if(!isFinite(cx) || !isFinite(cz)) continue;
            const src = c.color !== undefined ? c.color : c.paint;
            if(aiColorSrc[i] !== src || aiColorCss[i] === undefined){
                aiColorSrc[i] = src;
                aiColorCss[i] = cssColor(src, "#d8dde3");
            }
            ctx.beginPath();
            ctx.arc((cx - trackBounds.minX) * mapScale + mapOffX, (cz - trackBounds.minZ) * mapScale + mapOffY, 3.3 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = aiColorCss[i];
            ctx.fill();
            ctx.stroke();
        }
    }

    // 플레이어: 빨간 화살표 (맨 위)
    const x = (car.position.x - trackBounds.minX) * mapScale + mapOffX;
    const y = (car.position.z - trackBounds.minZ) * mapScale + mapOffY;
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

/* =========================================================
   RACE RESULTS — 결승 화면 순위표
   main.js 가 플레이어 결승 시 renderRaceResults(container) 호출.
   이후 결과 화면이 떠 있는 동안 1초마다 다시 계산해 AI 기록을 채운다.
========================================================= */
const resultsState = {container: null, html: "", next: 0};

function renderRaceResults(containerEl){
    if(!containerEl) return;
    resultsState.container = containerEl;
    resultsState.html = "";
    resultsState.next = performance.now() + 1000;
    buildRaceResults();
}

function playerResultRow(order){
    return {
        name: "YOU",
        color: cssColor(typeof LIVERY_RED !== "undefined" ? LIVERY_RED : 0xc8101e),
        isPlayer: true,
        finished: race.state === "finished",
        time: race.state === "finished" ? race.time : 0,
        best: race.bestLap,
        progress: physics.progress,
        gap: NaN,
        lapsDown: NaN,
        dnf: false,
        order
    };
}

function aiResultRow(e, order, finishLine){
    const progress = entryProgress(e);
    const time = typeof e.finishTime === "number" ? e.finishTime : 0;
    return {
        name: entryName(e),
        color: entryColor(e),
        isPlayer: false,
        finished: e.finished === true || time > 0,
        time: time > 0 ? time : 0,
        best: typeof e.bestLap === "number" ? e.bestLap : 0,
        progress,
        gap: typeof e.gapToLeader === "number" ? e.gapToLeader : NaN,
        lapsDown: typeof e.lapsDown === "number" ? e.lapsDown : NaN,
        dnf: !!(e.dnf || e.retired),
        order
    };
}

function buildRaceResults(){
    const el = resultsState.container;
    if(!el) return;
    const finishLine = raceSettings.laps * SAMPLE_COUNT;
    const rows = [];
    let hasPlayer = false;
    const list = safeStandings();
    if(list){
        for(let k = 0; k < list.length; k++){
            const e = list[k];
            if(!e) continue;
            if(entryIsPlayer(e)){
                if(hasPlayer) continue;
                hasPlayer = true;
                const row = playerResultRow(k);
                if(isFinite(entryProgress(e))) row.progress = entryProgress(e);
                rows.push(row);
            }else{
                rows.push(aiResultRow(e, k, finishLine));
            }
        }
    }else if(typeof aiCars !== "undefined" && aiCars){
        for(let k = 0; k < aiCars.length; k++) if(aiCars[k]) rows.push(aiResultRow(aiCars[k], k, finishLine));
    }
    if(!hasPlayer) rows.push(playerResultRow(rows.length));

    // getRaceStandings() 는 이미 정렬되어 있다. 다시 정렬해도 같은 기준:
    // 완주(기록 순) → 주행 중(진행 거리 순) → DNF
    const rank = r => r.dnf ? 2 : r.finished ? 0 : 1;
    rows.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if(ra !== rb) return ra - rb;
        if(ra === 0 && a.time > 0 && b.time > 0) return a.time - b.time;
        if(ra === 1 && isFinite(a.progress) && isFinite(b.progress) && a.progress !== b.progress) return b.progress - a.progress;
        return a.order - b.order;
    });

    const winnerTime = rows.length && rows[0].finished && rows[0].time > 0 ? rows[0].time : 0;
    let fastest = Infinity;
    for(const r of rows) if(r.best > 0 && r.best < fastest) fastest = r.best;

    let playerPos = 1;
    let body = "";
    for(let i = 0; i < rows.length; i++){
        const r = rows[i];
        if(r.isPlayer) playerPos = i + 1;
        let result;
        let cls = "";
        if(r.dnf){
            result = "DNF";
            cls = "dim";
        }else if(r.finished && r.time > 0){
            result = i === 0 || !winnerTime ? formatTime(r.time) : "+" + (r.time - winnerTime).toFixed(3) + "s";
        }else if(r.finished){
            result = "FINISH";
        }else{
            // 아직 주행 중: 바퀴 차이 또는 예상 간격 (흐리게)
            const laps = isFinite(r.lapsDown) ? r.lapsDown : (finishLine - (r.progress || 0)) / SAMPLE_COUNT;
            result = lapGapLabel(laps) || (r.gap > 0 && winnerTime ? "+" + r.gap.toFixed(1) + "s" : "주행 중");
            cls = "dim";
        }
        body += "<tr" + (r.isPlayer ? " class=\"me\"" : "") + ">" +
            "<td class=\"p\">" + (i + 1) + "</td>" +
            "<td class=\"n\"><i class=\"sw\" style=\"background:" + escapeHTML(r.color) + "\"></i>" + escapeHTML(r.name) + "</td>" +
            "<td class=\"t " + cls + "\">" + result + "</td>" +
            "<td class=\"b" + (r.best > 0 && r.best === fastest ? " fl" : "") + "\">" + formatTime(r.best) + "</td>" +
            "</tr>";
    }

    // 내 순위 · 총 시간 · 베스트 랩을 먼저, 그 아래 전체 순위표
    const html =
        "<div class=\"res-head\"><b>P" + playerPos + "</b><span>/ " + rows.length + "</span></div>" +
        "<div class=\"res-sum\">" +
        "<div><span>TOTAL</span><b>" + formatTime(race.state === "finished" ? race.time : 0) + "</b></div>" +
        "<div><span>BEST LAP</span><b class=\"best\">" + formatTime(race.bestLap) + "</b></div>" +
        "</div>" +
        "<table class=\"res-table\"><thead><tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>BEST</th></tr></thead>" +
        "<tbody>" + body + "</tbody></table>";

    if(html !== resultsState.html){
        resultsState.html = html;
        el.innerHTML = html;
    }
}
