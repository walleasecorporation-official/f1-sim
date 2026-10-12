/* =========================================================
   AI OPPONENTS — 상대 차량

   플레이어용 자전거 모델 대신 "레이싱 라인 + 속도 프로파일" 위를 달리는
   가벼운 모델 (모바일에서도 차량 7대 기준 프레임당 수십 µs).

   1  레이싱 라인: K1999 방식(곡률 평활화)으로 아웃-인-아웃 라인을 미리 계산
   2  속도 프로파일: 플레이어와 같은 2026 제원(다운포스·항력·제동)으로
      코너 한계 속도 → 제동 역방향 패스. 가속은 매 프레임 ICE + MGU-K 출력으로 계산
      (배터리 에너지·랩당 회수 한도·오버테이크 모드도 플레이어와 동일 규칙)
   3  차량별 실력(skill) 0.90 ~ 0.97: 코너 그립·제동·탈출 트랙션에 반영
      (앞 그리드일수록 빠름. 플라잉 랩 약 1:39 ~ 1:47)
   4  슬립스트림(항력↓) · 더티 에어(코너 속도↓): physics.computeWake 공용
   5  추월/회피: 앞차가 진로에 있으면 비어 있는 쪽 차선으로 이동, 없으면 감속해 따라감
      (멈춘 플레이어 차도 돌아서 간다. 나란히 달릴 때는 간격 유지, 뒤차가 양보)
   6  차량 간 접촉: 원 2개 근사, 겹침 해소 + 법선 속도 교환 (반발 0.3)

   외부 사용: aiCars, initAICars, resetAICars, updateAICars, resolveCarContacts,
             getRaceStandings, aiCarAhead
   좌표/진행 규칙은 physics 와 같다.
   progress = 누적 샘플 (그리드 = index - SAMPLE_COUNT, 출발선 = 0, 랩마다 +SAMPLE_COUNT)
   lateral  = 중심선 기준 오른쪽 + (m)
========================================================= */
"use strict";

/* ---------------------------------------------------------
   상수
--------------------------------------------------------- */
const AI_LINE_MARGIN = 1.6;                    // 레이싱 라인: 도로 끝에서 남기는 여유 (m)
const AI_LANE_MAX = ROAD_WIDTH / 2 - 1.2;      // 추월 차선 최대 횡위치 (m)
const AI_LAT_HARD = ROAD_WIDTH / 2 - .6;       // 접촉으로 밀려도 넘지 않는 한계
const AI_LAT_RATE = 3.0;                       // 레이싱 라인 대비 횡이동 속도 (m/s)
const AI_LAT_ACC = 10.0;                       // 횡이동 가속도 한계 (m/s²)
const AI_LAT_GAIN = 3.0;                       // 목표 오프셋까지 거리 → 횡속도 (1/s)
const AI_LAT_KNEE = 6.0;                       // 이 횡위치부터 도로 끝 쪽으로 부드럽게 포화
const AI_OVERLAP = 2.3;                        // 이 횡간격 미만이면 같은 진로 (m)
const AI_PASS_MARGIN = .55;                    // 추월 차선 = 앞차 횡위치 ± (겹침폭 + 여유)
const AI_MIN_GAP = 7.0;                        // 앞차와의 최소 중심 간격 (m)
const AI_CAR_LENGTH = 4.9;                     // 앞뒤로 이 거리 안이면 '나란히' (m)
const AI_MASS = VEHICLE.dryMass + 20;          // 연료 포함 평균 질량
const AI_MU = VEHICLE.mu * .9;                 // 플레이어 타이어 피크 대비 여유
const AI_TRACTION_MU = VEHICLE.mu * VEHICLE.rearGripBias * .9;
const AI_ICE_W = 360e3;                        // 휠 기준 ICE 출력 (≈400 kW × 구동 효율)
const AI_DECEL_CAP = 5 * G;
const AI_VMAX = 105;                           // 프로파일 상한 (m/s)
const AI_TOW_DRAG = SLIPSTREAM_DRAG_CUT;        // 슬립스트림 항력 감소 (플레이어와 동일)
const AI_CIRCLE_OFFSET = 1.4;                  // 충돌 원: 차량 중심 앞뒤 ±1.4 m
const AI_CIRCLE_RADIUS = .95;
const AI_RESTITUTION = .3;
const AI_COOL_SPEED = 55;                      // 완주 후 쿨다운 최고 속도 (m/s)

// 가상의 팀/드라이버 (실존 팀·드라이버와 무관). 플레이어 빨강(0xc8101e)과 겹치지 않는 색
const AI_ROSTER = [
    {name: "A. Lindqvist", code: "LIN", team: "Borealis", color: 0x1f5fd6, helmet: 0xffd21f},
    {name: "M. Okafor",    code: "OKA", team: "Verdant",  color: 0x13a05a, helmet: 0xf4f4f4},
    {name: "J. Castellan", code: "CSL", team: "Solenne",  color: 0xff8c1a, helmet: 0x1b1b1b},
    {name: "E. Novak",     code: "NVK", team: "Halcyon",  color: 0xdfe3e8, helmet: 0x1f5fd6},
    {name: "D. Ferraz",    code: "FRZ", team: "Nebula",   color: 0x7a3fe0, helmet: 0xfff04a},
    {name: "S. Han",       code: "HAN", team: "Arcadia",  color: 0xf2d000, helmet: 0x161616},
    {name: "T. Brandt",    code: "BRT", team: "Ironclad", color: 0x2a2f37, helmet: 0x2fe0ff}
];
// 출발 반응 시간 (s)
const AI_REACTION = [.21, .29, .18, .26, .23, .33, .2];

const aiCars = [];
let aiClock = 0;               // 레이스 시계 (플레이어 완주 후에도 계속 진행)
let aiContactCount = 0;        // 실제 충돌 횟수 (디버그/테스트용)

/* ---------------------------------------------------------
   레이싱 라인 (K1999 곡률 평활화)
   각 점의 곡률이 이웃 곡률의 평균이 되도록 횡위치를 조정한다.
   거친 간격(64 샘플)부터 1 샘플까지 단계적으로 내려가며 수렴.
--------------------------------------------------------- */
let aiLineLat = null;          // 샘플별 레이싱 라인 횡위치 (m, + 오른쪽)
let aiLineK = null;            // 레이싱 라인 곡률 절댓값 (1/m)
let aiLineDs = null;           // 샘플 i → i+1 레이싱 라인 길이 (m)
let aiRefCum = null;           // 기준 랩 누적 시간 (간격 추정용)
let aiRefLap = 0;
const aiProfiles = new Map();  // skill → 목표 속도 프로파일

function aiBuildRacingLine(){
    const N = SAMPLE_COUNT;
    const lim = ROAD_WIDTH / 2 - AI_LINE_MARGIN;
    const lane = new Float64Array(N);
    const px = new Float64Array(N), pz = new Float64Array(N);
    for(let i = 0; i < N; i++){ px[i] = trackSamples[i].x; pz[i] = trackSamples[i].z; }

    const setLane = (i, o) => {
        const s = trackSamples[i];
        o = Math.max(-lim, Math.min(lim, o));
        lane[i] = o;
        px[i] = s.x + s.rx * o;
        pz[i] = s.z + s.rz * o;
    };
    // 세 점(a, (x,z), b)을 지나는 원의 부호 있는 곡률
    const rInv = (a, x, z, b) => {
        const x1 = px[b] - x, z1 = pz[b] - z;
        const x2 = px[a] - x, z2 = pz[a] - z;
        const x3 = px[b] - px[a], z3 = pz[b] - pz[a];
        const det = x1 * z2 - x2 * z1;
        const nnn = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3));
        return nnn > 1e-12 ? 2 * det / nnn : 0;
    };
    // 점 i 를 현(prev-next) 위에 놓은 뒤 목표 곡률이 되도록 횡이동 (선형 근사)
    const adjust = (prev, i, next, target) => {
        const s = trackSamples[i];
        const dx = px[next] - px[prev], dz = pz[next] - pz[prev];
        const denom = s.rx * dz - s.rz * dx;
        let o = lane[i];
        if(Math.abs(denom) > 1e-9){
            o = ((px[prev] - s.x) * dz - (pz[prev] - s.z) * dx) / denom;
        }
        const delta = .01;
        const dr = rInv(prev, s.x + s.rx * (o + delta), s.z + s.rz * (o + delta), next);
        if(Math.abs(dr) > 1e-12) o += delta / dr * target;
        setLane(i, o);
    };
    const dist = (a, b) => Math.hypot(px[a] - px[b], pz[a] - pz[b]);

    const ITER = 30;
    for(let step = 64; step >= 1; step >>= 1){
        // 이 단계의 격자 점 (마지막 구간이 너무 짧으면 제외)
        const idx = [];
        for(let i = 0; i < N; i += step) idx.push(i);
        if(idx.length > 3 && N - idx[idx.length - 1] < step / 2) idx.pop();
        const M = idx.length;
        if(M < 5) continue;
        const iters = Math.round(ITER * Math.sqrt(step));
        for(let it = 0; it < iters; it++){
            for(let j = 0; j < M; j++){
                const pp = idx[(j - 2 + M) % M], p = idx[(j - 1 + M) % M];
                const i = idx[j];
                const n = idx[(j + 1) % M], nn = idx[(j + 2) % M];
                const ri0 = rInv(pp, px[p], pz[p], i);
                const ri1 = rInv(i, px[n], pz[n], nn);
                const lPrev = dist(i, p), lNext = dist(i, n);
                adjust(p, i, n, (lNext * ri0 + lPrev * ri1) / (lNext + lPrev));
            }
        }
        // 격자 사이 점 보간
        if(step > 1){
            for(let j = 0; j < M; j++){
                const p = idx[(j - 1 + M) % M], a = idx[j], b = idx[(j + 1) % M], n = idx[(j + 2) % M];
                const ir0 = rInv(p, px[a], pz[a], b);
                const ir1 = rInv(a, px[b], pz[b], n);
                const span = (b - a + N) % N;
                for(let k = 1; k < span; k++){
                    const x = k / span;
                    adjust(a, (a + k) % N, b, x * ir1 + (1 - x) * ir0);
                }
            }
        }
    }

    aiLineLat = new Float32Array(N);
    aiLineK = new Float32Array(N);
    aiLineDs = new Float32Array(N);
    for(let i = 0; i < N; i++){
        aiLineLat[i] = lane[i];
        const a = (i - 3 + N) % N, b = (i + 3) % N;
        aiLineK[i] = Math.abs(rInv(a, px[i], pz[i], b));
        aiLineDs[i] = dist(i, (i + 1) % N);
    }
}

/* ---------------------------------------------------------
   속도 프로파일 (2026 제원)
   코너 한계: v²κ = μ(g + ½ρ·ClA·v²/m)  →  v = √(μg / (κ − μ·½ρ·ClA/m))
   제동: μ(g + DF/m)·(마찰원 잔여) + 항력/m, 최대 5 g
--------------------------------------------------------- */
function aiLateralLimit(k, mu, claScale = 1){
    const den = k - mu * .6 * AERO_MODES.Z.ClA * claScale / AI_MASS;
    if(den <= 1e-6) return AI_VMAX;
    return Math.min(AI_VMAX, Math.sqrt(mu * G / den));
}

/** 직선 제동 최대 감속 (매 프레임 사용) */
function aiBrakeDecel(v, mu){
    const q = .6 * v * v;
    return Math.min(AI_DECEL_CAP, mu * (G + q * AERO_MODES.Z.ClA / AI_MASS) + q * AERO_MODES.Z.CdA / AI_MASS);
}

/** 코너 안에서 쓸 수 있는 감속 (횡그립 사용분을 뺀 마찰원) */
function aiBrakeDecelInCorner(v, k, mu, scale){
    const q = .6 * v * v;
    const grip = mu * (G + q * AERO_MODES.Z.ClA / AI_MASS);
    const use = Math.min(1, v * v * k / grip);
    const circle = Math.max(.35, Math.sqrt(1 - use * use));
    return Math.min(AI_DECEL_CAP, grip * circle * scale + q * AERO_MODES.Z.CdA / AI_MASS);
}

/** 가속 한계 (ICE + MGU-K, 트랙션·항력 반영). ersW: MGU-K 출력 (W), trac: 트랙션 사용 비율 */
function aiAccel(v, ersW, cda, cla, tow, trac){
    const q = .6 * v * v;
    const df = q * cla;
    const drag = q * cda * (1 - AI_TOW_DRAG * tow);
    const rolling = VEHICLE.rollingCoef * (AI_MASS * G + df * .3);
    const fIce = Math.min(AI_ICE_W / Math.max(v, 1), 9600);
    const fErs = Math.min(ersW / Math.max(v, 6), 9000);
    const traction = AI_TRACTION_MU * trac * (VEHICLE.cgToFront / VEHICLE.wheelBase * AI_MASS * G + .6 * df);
    return (Math.min(fIce + fErs, traction) - drag - rolling) / AI_MASS;
}

function aiSkillKey(skill){ return Math.round(skill * 1000); }

/* skill(0.90 ~ 0.97) → 실제로 쓰는 그립/제동/트랙션 비율
   코너 속도는 대략 skill^1.1, 제동 감속은 skill^1.6 정도로 줄어든다. */
function aiGripFactor(skill){ return 1 - 2.2 * (1 - skill); }
function aiBrakeFactor(skill){ return 1 - 1.6 * (1 - skill); }
function aiTractionFactor(skill){ return 1 - 1.2 * (1 - skill); }

/** skill 별 목표 속도 상한 (코너 한계 + 제동 역방향 패스) */
function aiGetSpeedProfile(skill){
    const key = aiSkillKey(skill);
    if(aiProfiles.has(key)) return aiProfiles.get(key);
    const N = SAMPLE_COUNT;
    const mu = AI_MU * aiGripFactor(skill);
    const brakeScale = aiBrakeFactor(skill);
    const cap = new Float32Array(N);
    for(let i = 0; i < N; i++) cap[i] = aiLateralLimit(aiLineK[i], mu);
    // 원형 트랙이므로 두 바퀴 돌려 경계 효과 제거
    for(let pass = 0; pass < 2; pass++){
        for(let i = N - 1; i >= 0; i--){
            const v1 = cap[(i + 1) % N];
            const d = aiBrakeDecelInCorner(v1, aiLineK[i], mu, brakeScale);
            const vmax = Math.sqrt(v1 * v1 + 2 * d * aiLineDs[i]);
            if(cap[i] > vmax) cap[i] = vmax;
        }
    }
    aiProfiles.set(key, cap);
    return cap;
}

/**
 * 순방향 패스로 기준 랩을 만든다 (ERS 평균 사용률 가정).
 * 반환: 랩 타임. out 이 주어지면 누적 시간(N+1)과 샘플별 속도를 채운다.
 */
function aiSimulateReferenceLap(cap, ersShare, outCum, outSpeed, skill = .94){
    const N = SAMPLE_COUNT;
    const X = AERO_MODES.X, Z = AERO_MODES.Z;
    let v = cap[0] * .8;
    let time = 0;
    for(let pass = 0; pass < 2; pass++){
        time = 0;
        if(outCum) outCum[0] = 0;
        for(let i = 0; i < N; i++){
            const zone = aeroZoneMask[i] === 1;
            const ersW = mgukPowerLimitKW(v * 3.6, false) * 1000 * ersShare;
            const a = aiAccel(v, ersW, zone ? X.CdA : Z.CdA, zone ? X.ClA : Z.ClA, 0, aiTractionFactor(skill));
            const ds = aiLineDs[i];
            let v1 = Math.sqrt(Math.max(1, v * v + 2 * a * ds));
            v1 = Math.min(v1, cap[(i + 1) % N]);
            time += 2 * ds / (v + v1);
            if(outSpeed) outSpeed[i] = v;
            if(outCum) outCum[i + 1] = time;
            v = v1;
        }
    }
    return time;
}

function ensureAIData(){
    if(aiLineLat) return;
    aiBuildRacingLine();
    aiRefCum = new Float64Array(SAMPLE_COUNT + 1);
    aiRefLap = aiSimulateReferenceLap(aiGetSpeedProfile(.94), .3, aiRefCum, null, .94);
}

/* ---------------------------------------------------------
   보간 도우미 (progress 는 실수)
--------------------------------------------------------- */
function aiWrapIndex(i){
    const N = SAMPLE_COUNT;
    return ((i % N) + N) % N;
}

function aiArrayAt(arr, p){
    const fl = Math.floor(p);
    const f = p - fl;
    const i0 = aiWrapIndex(fl);
    const i1 = i0 + 1 === SAMPLE_COUNT ? 0 : i0 + 1;
    return arr[i0] + (arr[i1] - arr[i0]) * f;
}

/** 두 progress 사이 트랙상 거리 (m, b 가 앞이면 +). 랩 차이는 무시 (물리적 거리) */
function aiTrackGap(pa, pb){
    const N = SAMPLE_COUNT;
    let d = (pb - pa) % N;
    if(d > N / 2) d -= N;
    else if(d < -N / 2) d += N;
    return d * SAMPLE_SPACING;
}

/** 기준 랩 시간축에서의 시각 (progress → s). 간격(초) 추정용 */
function aiRefTimeAt(p){
    const N = SAMPLE_COUNT;
    const lapN = Math.floor(p / N);
    const r = p - lapN * N;
    const i = Math.min(N - 1, Math.floor(r));
    const f = r - i;
    return lapN * aiRefLap + aiRefCum[i] + (aiRefCum[i + 1] - aiRefCum[i]) * f;
}

/* ---------------------------------------------------------
   초기화 / 리셋
--------------------------------------------------------- */
function aiSkillFor(k, count){
    // 앞 그리드일수록 빠르다 (예선 순서). 마지막 차는 초보도 이길 수 있게
    if(count <= 1) return .935;
    return .97 - .07 * k / (count - 1);
}

/** 이 차량만 가진 GPU 자원(병합 지오메트리, 복제 재질)만 해제 — 플레이어와 공유하는 것은 유지 */
function disposeAICarMesh(mesh){
    scene.remove(mesh);
    // 공유 템플릿 지오메트리를 쓰는 경우: 이 차량 전용으로 복제한 재질만 해제
    if(mesh.userData.sharedGeometry){
        const own = mesh.userData.ownMaterials || [];
        for(const mat of own) mat.dispose();
        return;
    }
    const shared = new Set();
    car.traverse(o => {
        if(!o.isMesh) return;
        shared.add(o.geometry);
        shared.add(o.material);
    });
    mesh.traverse(o => {
        if(!o.isMesh) return;
        if(!shared.has(o.geometry)) o.geometry.dispose();
        if(!shared.has(o.material)) o.material.dispose();
    });
}

function initAICars(count){
    count = Math.max(0, Math.min(AI_ROSTER.length, count | 0));
    if(count > 0) ensureAIData();

    // 남는 차량 제거
    while(aiCars.length > count){
        const c = aiCars.pop();
        if(c.mesh) disposeAICarMesh(c.mesh);
    }
    for(let k = 0; k < count; k++){
        const r = AI_ROSTER[k];
        let c = aiCars[k];
        if(!c){
            c = {
                index: k,
                name: r.name, code: r.code, team: r.team, color: r.color,
                mesh: null,
                x: 0, z: 0, yaw: 0,
                u: 0, progress: 0, lateral: 0, trackIndex: 0,
                lap: 1, lapsDone: 0, finished: false, finishTime: 0,
                bestLap: 0, lastLap: 0, lapStart: 0, braking: false,
                offset: 0, offVel: 0, latVel: 0, latKick: 0, prevLateral: 0,
                skill: 1, brakeF: 1, tractionF: 1, profile: null, launchDelay: 0, paceLap: 1,
                ers: 0, harvested: 0, overrideArmed: false, overrideActive: false,
                lastZone: -1, lastZoneProgress: -Infinity,
                aeroBlend: 0, tow: 0, dirty: 0, gapAhead: Infinity,
                coolLat: 0, lightOn: false, speedKmh: 0,
                passTarget: -1, passSide: 0, lineVel: 0, prevLine: 0
            };
            aiCars.push(c);
        }
        if(!c.mesh && typeof createAICarMesh === "function"){
            c.mesh = createAICarMesh(r.color, r.helmet);
        }
        c.skill = aiSkillFor(k, count);
        c.brakeF = aiBrakeFactor(c.skill);
        c.tractionF = aiTractionFactor(c.skill);
        c.profile = aiGetSpeedProfile(c.skill);
        c.launchDelay = AI_REACTION[k % AI_REACTION.length];
    }
}

function resetAICars(){
    aiClock = 0;
    aiContactCount = 0;
    for(let k = 0; k < aiCars.length; k++){
        const c = aiCars[k];
        const g = gridSlotPosition(k);
        const s = trackSamples[g.index];
        c.progress = g.index - SAMPLE_COUNT;
        c.trackIndex = g.index;
        c.lateral = (g.x - s.x) * s.rx + (g.z - s.z) * s.rz;
        c.offset = c.lateral - aiLineLat[g.index];
        c.prevLateral = c.lateral;
        c.offVel = c.latVel = c.latKick = 0;
        c.x = g.x; c.z = g.z; c.yaw = g.yaw;
        c.u = 0; c.speedKmh = 0;
        c.lap = 1; c.lapsDone = 0;
        c.finished = false; c.finishTime = 0;
        c.bestLap = 0; c.lastLap = 0; c.lapStart = 0;
        c.braking = false;
        c.paceLap = aiPaceFor(c, 1);
        c.ers = 3.4e6; c.harvested = 0;
        c.overrideArmed = c.overrideActive = false;
        c.lastZone = -1; c.lastZoneProgress = -Infinity;
        c.aeroBlend = 0; c.tow = c.dirty = 0; c.gapAhead = Infinity;
        c.coolLat = 0;
        c.passTarget = -1; c.passSide = 0;
        c.prevLine = aiLineLat[g.index]; c.lineVel = 0;
        renderAICar(c);
    }
}

/** 랩마다 아주 작은 페이스 변화 (결정적) */
function aiPaceFor(c, lap){
    return 1 + .004 * Math.sin(lap * 1.9 + c.index * 2.7);
}

/* ---------------------------------------------------------
   플레이어 상태 (트래픽/순위용) — 매 프레임 한 번 갱신
--------------------------------------------------------- */
const aiPlayer = {active: false, progress: 0, lateral: 0, u: 0, latVel: 0, width: AI_OVERLAP};
const aiTmpVel = {x: 0, z: 0};

function aiRefreshPlayer(){
    if(typeof physics === "undefined" || typeof car === "undefined"){
        aiPlayer.active = false;
        return;
    }
    const q = queryTrack(car.position.x, car.position.z, physics.trackIndex);
    const idx = q.index, lat = q.lateral;
    let d = idx - physics.trackIndex;
    if(d > SAMPLE_COUNT / 2) d -= SAMPLE_COUNT;
    if(d < -SAMPLE_COUNT / 2) d += SAMPLE_COUNT;
    const s = trackSamples[idx];
    const frac = ((car.position.x - s.x) * s.tx + (car.position.z - s.z) * s.tz) / SAMPLE_SPACING;
    aiPlayer.progress = physics.progress + d + frac;
    aiPlayer.lateral = lat;
    playerWorldVelocity(aiTmpVel);
    aiPlayer.u = aiTmpVel.x * s.tx + aiTmpVel.z * s.tz;
    aiPlayer.latVel = aiTmpVel.x * s.rx + aiTmpVel.z * s.rz;
    // 차가 옆으로 돌아 있으면 차지하는 폭이 넓어진다
    const trackYaw = Math.atan2(-s.tx, -s.tz);
    aiPlayer.width = AI_OVERLAP + 2.3 * Math.abs(Math.sin(physics.yaw - trackYaw));
    aiPlayer.active = Math.abs(lat) < ROAD_WIDTH / 2 + 2.5;
}

/* ---------------------------------------------------------
   트래픽용 차량 목록 (AI 0..n-1, 플레이어 = n) — 고정 배열 재사용
--------------------------------------------------------- */
const AI_MAX_BODIES = AI_ROSTER.length + 1;
const aiBodyP = new Float64Array(AI_MAX_BODIES);
const aiBodyLat = new Float64Array(AI_MAX_BODIES);
const aiBodyU = new Float64Array(AI_MAX_BODIES);
const aiBodyW = new Float64Array(AI_MAX_BODIES);
const aiBodyLV = new Float64Array(AI_MAX_BODIES);     // 횡속도 (m/s, + 오른쪽)
const aiBodyOn = new Uint8Array(AI_MAX_BODIES);
let aiBodyCount = 0;

function aiFillBodies(){
    const n = aiCars.length;
    for(let i = 0; i < n; i++){
        const c = aiCars[i];
        aiBodyP[i] = c.progress; aiBodyLat[i] = c.lateral; aiBodyU[i] = c.u; aiBodyW[i] = AI_OVERLAP; aiBodyOn[i] = 1;
        aiBodyLV[i] = c.latVel;
    }
    aiBodyP[n] = aiPlayer.progress; aiBodyLat[n] = aiPlayer.lateral; aiBodyU[n] = aiPlayer.u;
    aiBodyW[n] = aiPlayer.width; aiBodyOn[n] = aiPlayer.active ? 1 : 0; aiBodyLV[n] = aiPlayer.latVel;
    aiBodyCount = n + 1;
}

/**
 * 추월 차선 선택: 앞차(bi)의 좌/우 중 비어 있는 쪽. 없으면 NaN
 * 레이싱 라인이 코너에서 트랙을 가로지르므로 "앞차 위치에 도달했을 때의 내 횡위치"
 * (지금 오프셋 유지 가정)로 어느 쪽에 있는지 판단한다.
 * 같은 앞차를 추월하는 동안에는 처음 고른 쪽을 유지한다 (좌우로 흔들리지 않게).
 * 결과 쪽(-1/+1)은 aiLaneSide 에 남긴다.
 */
let aiLaneSide = 0;
function aiChooseLane(ci, bi, blockD, offset, keepSide){
    const myP = aiBodyP[ci];
    const pb = aiBodyP[bi];
    const latB = aiBodyLat[bi];
    const lineB = aiArrayAt(aiLineLat, pb);
    const myThere = aiSoftLat(lineB + offset);
    const sep = aiBodyW[bi] + AI_PASS_MARGIN;
    // 다음 코너 안쪽을 약간 선호 (좌코너 → 왼쪽 = 음수)
    const kAhead = sampleAt(Math.round(pb) + 24).k;
    const inside = kAhead > 1 / 400 ? -1 : kAhead < -1 / 400 ? 1 : 0;
    // 앞차와 횡으로 이미 어긋나 있으면 그쪽, 거의 정면 뒤면 양쪽 모두 가능
    const mySide = myThere - latB > .5 ? 1 : myThere - latB < -.5 ? -1 : 0;
    const myLat = aiBodyLat[ci];
    const physSide = myLat - latB > .5 ? 1 : myLat - latB < -.5 ? -1 : 0;
    const nAI = aiCars.length;
    let best = NaN, bestCost = Infinity;
    aiLaneSide = 0;
    for(let side = -1; side <= 1; side += 2){
        const lane = Math.max(-AI_LANE_MAX, Math.min(AI_LANE_MAX, latB + side * sep));
        if(Math.abs(lane - latB) < aiBodyW[bi] + .25) continue;   // 도로 끝까지 붙어도 공간 부족
        // 가까운 앞차 뒤를 가로지르는 차선은 쓰지 않는다 (지금 위치/도달 시 위치 모두 반대쪽일 때)
        // (내가 거의 멈춰 있으면 예외 — 멈춘 플레이어 뒤에서 영원히 서 있지 않도록)
        if(mySide !== 0 && side !== mySide && side !== physSide && side !== keepSide && blockD < 30 && aiBodyU[ci] > 6) continue;
        let free = true;
        for(let j = 0; j < aiBodyCount; j++){
            if(j === ci || j === bi || !aiBodyOn[j]) continue;
            const d = aiTrackGap(myP, aiBodyP[j]);
            // 앞쪽 그 차선에 있는 차만 (뒤나 옆의 차는 스스로 피하고, 끼어들기는 횡이동 단계에서 막는다)
            if(d <= 0 || d > blockD + 25) continue;
            // 그 차선에서 움직이고 있는 차는 따라가면 된다 → 거의 멈춘 차만 차선을 막는다
            if(aiBodyU[j] > 5) continue;
            // AI 는 오프셋을 유지한다고 보고 앞차 위치로 옮겨 비교
            const latJ = j < nAI ? aiSoftLat(aiBodyLat[j] - aiArrayAt(aiLineLat, aiBodyP[j]) + lineB) : aiBodyLat[j];
            if(Math.abs(latJ - lane) < aiBodyW[j]){ free = false; break; }
        }
        if(!free) continue;
        let cost = Math.abs(lane - myThere) - (side === inside ? 1.5 : 0);
        if(side !== mySide && mySide !== 0) cost += 4;
        if(side === keepSide) cost -= 6;
        if(cost < bestCost){ bestCost = cost; best = lane; aiLaneSide = side; }
    }
    if(best !== best) return NaN;
    return aiPassOffset(myP, bi, best, aiLaneSide);
}

/**
 * 앞차(bi)를 횡위치 lane 으로 지나가기 위한 오프셋.
 * 앞차에 닿기 직전(차 길이 앞)과 나란해지는 지점 모두에서 lane 바깥에 있도록
 * 두 지점의 레이싱 라인 차이를 고려한다 (헤어핀에서 라인이 트랙을 가로지를 때).
 */
function aiPassOffset(myP, bi, lane, side){
    const pb = aiBodyP[bi];
    const offThere = lane - aiArrayAt(aiLineLat, pb);
    const d = aiTrackGap(myP, pb);
    if(d <= AI_CAR_LENGTH) return offThere;
    const offNear = lane - aiArrayAt(aiLineLat, pb - AI_CAR_LENGTH / SAMPLE_SPACING);
    return side < 0 ? Math.min(offThere, offNear) : Math.max(offThere, offNear);
}

/* ---------------------------------------------------------
   주행 (차량 1대, 1 스텝)
--------------------------------------------------------- */
/** 도로 끝 근처에서 부드럽게 포화되는 횡위치 제한 (±AI_LANE_MAX) */
function aiSoftLat(x){
    const a = Math.abs(x);
    if(a <= AI_LAT_KNEE) return x;
    const w = AI_LANE_MAX - AI_LAT_KNEE;
    const y = AI_LAT_KNEE + w * Math.tanh((a - AI_LAT_KNEE) / w);
    return x < 0 ? -y : y;
}

/** 차량 위치(progress)에서 오프셋을 유지했을 때의 횡위치 */
function aiLatWithOffset(p, offset){
    return aiSoftLat(aiArrayAt(aiLineLat, p) + offset);
}

function driveAICar(c, ci, dt){
    const N = SAMPLE_COUNT;
    const X = AERO_MODES.X, Z = AERO_MODES.Z;

    // 출발 반응 시간
    if(aiClock < c.launchDelay && c.progress < 0 && c.u === 0){
        c.braking = false;
        return;
    }

    /* --- 후류 --- */
    if(typeof computeWake === "function"){
        const w = computeWake(c.progress, c.lateral, c);
        const kf = Math.min(1, dt * 4);
        c.tow += (w.tow - c.tow) * kf;
        c.dirty += (w.dirty - c.dirty) * kf;
    }

    /* --- 목표 속도 --- */
    const u = c.u;
    const myP = c.progress;
    const lineHere = aiArrayAt(aiLineLat, myP);
    // 레이싱 라인 자체의 횡이동 속도 (m/s)
    c.lineVel = (lineHere - c.prevLine) / dt;
    c.prevLine = lineHere;
    let target = aiArrayAt(c.profile, myP + u * dt / SAMPLE_SPACING);
    const kLook = aiArrayAt(aiLineK, myP + (8 + u * .6) / SAMPLE_SPACING);
    const corner = Math.min(1, kLook * 80);
    target *= 1 + (c.paceLap - 1) * corner;
    // 더티 에어: 플레이어와 같은 다운포스 손실(DIRTY_AIR_DF_LOSS)을 코너 한계 속도에 반영 — 고속 코너일수록 손해가 크다
    if(c.dirty > .01 && kLook > 1e-4){
        const muS = AI_MU * aiGripFactor(c.skill);
        const v0 = aiLateralLimit(kLook, muS);
        if(v0 < AI_VMAX) target *= aiLateralLimit(kLook, muS, 1 - DIRTY_AIR_DF_LOSS * c.dirty) / v0;
    }
    // 레이싱 라인을 벗어나 있으면 코너에서 조금 느리게
    target *= 1 - Math.min(.15, Math.abs(c.lateral - lineHere) * kLook * .6);
    if(c.finished) target = Math.min(target * .82, AI_COOL_SPEED);

    /* --- 트래픽: 지금 오프셋으로 달렸을 때 진로에 있는 차들
       가장 가까운 차 = 추월 대상, 진로에 있는 모든 차 = 속도 제한 --- */
    let block = -1, blockD = Infinity, gapAhead = Infinity;
    const dFollow = aiBrakeDecel(u, AI_MU) * c.brakeF * .7;
    const kT = trackSamples[c.trackIndex].k;
    for(let j = 0; j < aiBodyCount; j++){
        if(j === ci || !aiBodyOn[j]) continue;
        const d = aiTrackGap(myP, aiBodyP[j]);
        if(d <= .3) continue;
        if(d < gapAhead) gapAhead = d;
        const uj = Math.max(0, aiBodyU[j]);
        const closing = Math.max(0, u - uj);
        if(d > 25 + closing + closing * closing / 40) continue;
        if(uj > u + 2 && d > 12) continue;           // 멀어지는 중
        const latJ = aiBodyLat[j];
        // 그 차 위치, 그리고 그 차 꽁무니에 닿는 지점에서의 내 횡위치 (오프셋 유지 가정)
        const latThere = aiLatWithOffset(aiBodyP[j], c.offset);
        const latNear = d > AI_CAR_LENGTH ? aiLatWithOffset(aiBodyP[j] - AI_CAR_LENGTH / SAMPLE_SPACING, c.offset) : c.lateral;
        if(Math.abs(latJ - latThere) >= aiBodyW[j] && Math.abs(latJ - latNear) >= aiBodyW[j]) continue;
        if(d < blockD){ blockD = d; block = j; }
        // 같은 진로: 앞차 속도까지 줄일 수 있는 속도로 제한
        // (코너에서는 차가 달리는 횡위치의 실제 경로 길이로 간격을 잰다)
        const gap = d * Math.max(.5, Math.min(1.6, 1 + kT * (c.lateral + latJ) * .5));
        const room = gap - AI_MIN_GAP;
        let vAllow;
        if(room > 0) vAllow = Math.sqrt(uj * uj + 2 * dFollow * room);
        else if(d < 3.5) vAllow = uj;                // 거의 나란히: 속도만 맞춘다
        else vAllow = uj * Math.max(.7, 1 + room * .06);
        if(vAllow < target) target = vAllow;
    }
    c.gapAhead = gapAhead;

    /* --- 옆에 나란히 붙은 차: 너무 가까우면 벌리고, 뒤쪽 차가 양보 --- */
    let escape = 0;
    for(let j = 0; j < aiBodyCount; j++){
        if(j === ci || !aiBodyOn[j]) continue;
        const d = aiTrackGap(myP, aiBodyP[j]);
        if(d < -AI_CAR_LENGTH || d > AI_CAR_LENGTH) continue;
        const side = aiBodyLat[j] - c.lateral;
        // 0.35초 뒤 예상 간격 (서로 다가오는 중이면 미리 반응)
        const closing = (c.latVel - aiBodyLV[j]) * (side > 0 ? 1 : -1);
        if(Math.abs(side) - Math.max(0, closing) * .35 >= aiBodyW[j] + .3) continue;
        escape = side > 0 ? -1 : 1;
        if(d > 0){
            const yieldSpeed = Math.max(0, aiBodyU[j] - 1.5);
            if(yieldSpeed < target) target = yieldSpeed;
        }
    }

    let desired;
    if(c.finished){
        desired = c.coolLat - lineHere;
    }else if(aiClock < c.launchDelay + 2.5 && myP < 0){
        desired = c.offset;                          // 출발 직후에는 그리드 줄 유지
    }else{
        desired = 0;
    }

    if(block >= 0){
        const uj = Math.max(0, aiBodyU[block]);
        // 앞차가 느리면 추월 차선으로, 아니면 지금 줄을 유지하며 따라간다
        desired = c.offset;
        if(uj < u - .3 || uj < target * .97 || uj < 3){
            const keep = c.passTarget === block ? c.passSide : 0;
            const off = aiChooseLane(ci, block, blockD, c.offset, keep);
            if(off === off){
                desired = off;
                c.passTarget = block;
                c.passSide = aiLaneSide;
            }
        }
    }else if(c.passTarget >= 0 && c.passTarget < aiBodyCount){
        // 추월 중인 차를 완전히 지나칠 때까지는 추월 차선을 유지 (라인으로 돌아가며 다시 막히지 않게)
        const t = c.passTarget;
        const d = aiTrackGap(myP, aiBodyP[t]);
        if(d < -(AI_CAR_LENGTH + 3) || d > 60 || !aiBodyOn[t]){
            c.passTarget = -1;
        }else if(!c.finished){
            const lane = Math.max(-AI_LANE_MAX, Math.min(AI_LANE_MAX, aiBodyLat[t] + c.passSide * (aiBodyW[t] + AI_PASS_MARGIN)));
            desired = aiPassOffset(myP, t, lane, c.passSide);
        }
    }

    /* --- 종방향 --- */
    const zone = aeroZoneMask[c.trackIndex] === 1;
    const wantX = zone && !c.braking && u > 25 && Math.abs(c.offVel) < .5;
    const aStep = dt / AERO_SWITCH_TIME;
    c.aeroBlend += Math.max(-aStep, Math.min(aStep, (wantX ? 1 : 0) - c.aeroBlend));
    const cda = Z.CdA + (X.CdA - Z.CdA) * c.aeroBlend;
    const cla = Z.ClA + (X.ClA - Z.ClA) * c.aeroBlend;
    const q = .6 * u * u;
    const drag = q * cda * (1 - AI_TOW_DRAG * c.tow);
    const rolling = VEHICLE.rollingCoef * (AI_MASS * G + q * cla * .3);

    let a;
    let harvestW = 0;
    if(u < target - .02){
        // 플레이어와 같은 규칙: 오버테이크는 직선(에어로 구간)에서만, SOC 배치 맵으로 배터리 관리
        c.overrideActive = c.overrideArmed && aeroZoneMask[c.trackIndex] === 1 && c.ers > POWER_UNIT.deployMinJ;
        const socScale = c.overrideActive ? 1 : Math.max(POWER_UNIT.deployMinScale, Math.min(1, c.ers / POWER_UNIT.deployTaperJ));
        const ersW = c.ers > POWER_UNIT.deployMinJ ? mgukPowerLimitKW(u * 3.6, c.overrideActive) * 1000 * socScale : 0;
        const aMax = aiAccel(u, ersW, cda, cla, c.tow, c.tractionF);
        a = Math.min(aMax, (target - u) / dt);
        // MGU-K 사용량: 실제 필요한 구동력 비율만큼 (모터 효율 95%)
        if(ersW > 0 && a > 0){
            const fIce = Math.min(AI_ICE_W / Math.max(u, 1), 9600);
            const fErs = Math.min(ersW / Math.max(u, 6), 9000);
            const need = a * AI_MASS + drag + rolling;
            const share = Math.max(0, Math.min(1, need / (fIce + fErs)));
            c.ers = Math.max(0, c.ers - fErs * Math.max(u, 1) * share * dt / .95);
        }
        c.braking = false;
    }else{
        c.overrideActive = false;
        const dMax = aiBrakeDecel(u, AI_MU) * c.brakeF;
        a = -Math.min(dMax, (u - target) / dt);
        const coast = (drag + rolling) / AI_MASS;
        c.braking = -a > coast + 6;
        if(c.braking && u > 3){
            // 후륜 제동력의 일부를 MGU-K 로 회수 (최대 350 kW)
            harvestW = Math.min(POWER_UNIT.mgukMaxKW * 1000, (-a * AI_MASS - drag - rolling) * (1 - VEHICLE.brakeBias) * u);
        }else if(a < 0 && u > 30){
            harvestW = POWER_UNIT.liftHarvestKW * 1000 * Math.min(1, (u - 30) / 15);
        }
    }
    if(harvestW > 0){
        const capJ = POWER_UNIT.harvestPerLap + (c.overrideArmed ? POWER_UNIT.overrideExtra : 0);
        const j = Math.min(harvestW * dt, Math.max(0, capJ - c.harvested));
        c.harvested += j;
        c.ers = Math.min(POWER_UNIT.esCapacity, c.ers + j * .9);
    }
    c.u = Math.max(0, u + a * dt);
    c.speedKmh = c.u * 3.6;

    /* --- 횡방향: 레이싱 라인 대비 오프셋 (속도 ±3 m/s, 가속도 제한) --- */
    // 거의 멈춘 상태에서는 옆으로 천천히만 움직인다
    const latRate = Math.min(AI_LAT_RATE, 1.5 + .35 * c.u);
    let vDes = Math.max(-latRate, Math.min(latRate, (desired - c.offset) * AI_LAT_GAIN));
    let latAcc = AI_LAT_ACC;
    if(escape !== 0){
        // 레이싱 라인이 옆 차 쪽으로 흐르고 있으면 그만큼 더 반대로 (실제 횡위치가 벌어지도록)
        vDes = escape * latRate;
        if(c.lineVel * escape < 0) vDes -= c.lineVel;
        vDes = Math.max(-8, Math.min(8, vDes));
        latAcc *= 2;
    }else if(vDes !== 0){
        // 옆에 나란히 있는 차, 또는 뒤에서 빠르게 다가오는 차 쪽으로는 끼어들지 않는다
        for(let j = 0; j < aiBodyCount; j++){
            if(j === ci || !aiBodyOn[j]) continue;
            const d = aiTrackGap(myP, aiBodyP[j]);
            if(d > AI_CAR_LENGTH || d < -9) continue;
            if(d < -AI_CAR_LENGTH && aiBodyU[j] < c.u + 1) continue;
            const side = aiBodyLat[j] - c.lateral;
            if(side * vDes > 0 && Math.abs(side) < aiBodyW[j] + .6){ vDes = 0; break; }
        }
    }
    const accStep = latAcc * dt;
    c.offVel += Math.max(-accStep, Math.min(accStep, vDes - c.offVel));
    c.offset += c.offVel * dt;
    // 접촉으로 생긴 횡속도 (빠르게 감쇠)
    if(c.latKick !== 0){
        c.offset += c.latKick * dt;
        c.latKick *= Math.max(0, 1 - dt * 6);
        if(Math.abs(c.latKick) < .02) c.latKick = 0;
    }
    // 오프셋(의도)은 도로 폭 안에서만
    if(c.offset > ROAD_WIDTH){ c.offset = ROAD_WIDTH; c.offVel = Math.min(0, c.offVel); }
    else if(c.offset < -ROAD_WIDTH){ c.offset = -ROAD_WIDTH; c.offVel = Math.max(0, c.offVel); }

    /* --- 진행 --- */
    const oldP = c.progress;
    const kTrack = trackSamples[aiWrapIndex(Math.floor(oldP))].k;
    const segLen = (TRACK_LENGTH / N) * Math.max(.5, Math.min(1.6, 1 + kTrack * c.lateral));
    const lv = c.latVel;
    const along = Math.sqrt(Math.max(c.u * c.u * .25, c.u * c.u - lv * lv));
    c.progress = oldP + along * dt / segLen;

    // 새 위치의 횡위치 (도로 끝에서 부드럽게 포화)
    let lat = aiLatWithOffset(c.progress, c.offset);
    if(Math.abs(c.lateral) > AI_LANE_MAX){
        // 접촉으로 바깥에 밀려난 상태 → 천천히 복귀
        const m = AI_LAT_RATE * dt;
        lat = Math.max(c.lateral - m, Math.min(c.lateral + m, lat));
    }
    c.prevLateral = c.lateral;
    c.lateral = lat;
    c.latVel = (lat - c.prevLateral) / dt;

    /* --- 랩 / 오버테이크 판정 --- */
    aiLapBookkeeping(c, oldP, dt);
    aiOverrideDetection(c);
}

function aiLapBookkeeping(c, oldP, dt){
    const N = SAMPLE_COUNT;
    const k = Math.floor(c.progress / N);
    // 접촉으로 결승선 뒤로 밀렸다가 다시 넘는 경우 같은 랩을 두 번 세지 않는다
    if(k <= Math.floor(oldP / N) || k < 0 || (k >= 1 && k <= c.lapsDone)) return;
    // 결승선(랩 시작) 통과: 랩당 ERS 회수 한도 초기화
    c.harvested = 0;
    if(k < 1) return;
    const frac = (c.progress - k * N) / Math.max(1e-6, c.progress - oldP);
    const tCross = aiClock - dt * Math.min(1, frac);
    const lapTime = tCross - c.lapStart;
    c.lastLap = lapTime;
    if(!c.bestLap || lapTime < c.bestLap) c.bestLap = lapTime;
    c.lapStart = tCross;
    c.lapsDone = k;
    const laps = raceSettings.laps;
    c.lap = Math.min(laps, k + 1);
    c.paceLap = aiPaceFor(c, k + 1);
    if(k >= laps && !c.finished){
        c.finished = true;
        c.finishTime = tCross;
        // 쿨다운: 레이싱 라인 반대편 차선으로 비켜서 달린다
        const line = aiArrayAt(aiLineLat, c.progress);
        c.coolLat = (line >= 0 ? -1 : 1) * 5.2;
    }
}

function aiOverrideDetection(c){
    const idx = c.trackIndex;
    for(let z = 0; z < aeroZones.length; z++){
        let d = idx - aeroZones[z].start;
        if(d < 0) d += SAMPLE_COUNT;
        if(d >= 4) continue;
        if(c.lastZone === z && c.progress - c.lastZoneProgress < SAMPLE_COUNT / 2) continue;
        c.lastZone = z;
        c.lastZoneProgress = c.progress;
        c.overrideArmed = c.gapAhead / Math.max(10, c.u) <= 1.0;
    }
}

/* ---------------------------------------------------------
   위치 / 방향 / 메시
--------------------------------------------------------- */
function placeAICar(c, dt){
    const N = SAMPLE_COUNT;
    const p = c.progress;
    const fl = Math.floor(p);
    const f = p - fl;
    const i0 = aiWrapIndex(fl);
    const i1 = i0 + 1 === N ? 0 : i0 + 1;
    const a = trackSamples[i0], b = trackSamples[i1];
    const rx = a.rx + (b.rx - a.rx) * f, rz = a.rz + (b.rz - a.rz) * f;
    c.x = a.x + (b.x - a.x) * f + rx * c.lateral;
    c.z = a.z + (b.z - a.z) * f + rz * c.lateral;
    c.trackIndex = f < .5 ? i0 : i1;
    if(dt > 0){
        // 진행 방향 = 접선 × 전진 성분 + 오른쪽 × 횡속도
        const tx = a.tx + (b.tx - a.tx) * f, tz = a.tz + (b.tz - a.tz) * f;
        // 저속에서 옆으로 움직일 때 차체가 과하게 돌아가지 않도록 (최대 약 25°)
        const fwd = Math.sqrt(Math.max(.25, c.u * c.u - c.latVel * c.latVel));
        const lv = Math.max(-fwd * .47, Math.min(fwd * .47, c.latVel));
        const dx = tx * fwd + rx * lv, dz = tz * fwd + rz * lv;
        const yaw = Math.atan2(-dx, -dz);
        let d = yaw - c.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.yaw += d * Math.min(1, dt * 14);
    }
}

function renderAICar(c){
    const m = c.mesh;
    if(!m) return;
    m.position.set(c.x, 0, c.z);
    m.rotation.y = c.yaw;
    const dx = c.x - camera.position.x, dz = c.z - camera.position.z;
    const d2 = dx * dx + dz * dz;
    const r = QUALITY_NAME === "low" ? 300 : 450;
    m.visible = d2 < r * r;
    // LOD: 70 m 밖에서는 작은 부품(헬멧, 휠 디스크, 라이트 등)을 숨겨 draw call 을 줄인다
    const near = d2 < 4900;
    const detail = m.userData.detail;
    if(detail && m.userData.near !== near){
        m.userData.near = near;
        for(let i = 0; i < detail.length; i++) detail[i].visible = near;
    }
    if(c.braking !== c.lightOn && m.userData.rainLight){
        c.lightOn = c.braking;
        m.userData.rainLight.color.setHex(c.braking ? 0xff2020 : 0x550000);
    }
}

/* ---------------------------------------------------------
   프레임 업데이트
--------------------------------------------------------- */
function updateAICars(dt, locked){
    const n = aiCars.length;
    if(n === 0) return;
    if(locked || !(dt > 0)){
        for(let i = 0; i < n; i++) renderAICar(aiCars[i]);
        return;
    }
    if(race.state === "racing") aiClock = race.time;
    else aiClock += dt;

    aiRefreshPlayer();
    aiFillBodies();
    for(let i = 0; i < n; i++){
        const c = aiCars[i];
        driveAICar(c, i, dt);
        placeAICar(c, dt);
        aiBodyP[i] = c.progress; aiBodyLat[i] = c.lateral; aiBodyU[i] = c.u; aiBodyLV[i] = c.latVel;
    }
    for(let i = 0; i < n; i++) renderAICar(aiCars[i]);
}

/* ---------------------------------------------------------
   차량 간 접촉 (플레이어 ↔ AI, AI ↔ AI)
   차량 = 진행 방향 앞뒤 ±1.4 m 의 원 2개 (반경 0.95 m)
--------------------------------------------------------- */
const aiContactBody = [];
for(let i = 0; i < AI_MAX_BODIES; i++) aiContactBody.push({x: 0, z: 0, fx: 0, fz: 0, vx: 0, vz: 0, dirty: false});
const aiContactVel = {x: 0, z: 0};

function aiLoadContactBody(i, n){
    const b = aiContactBody[i];
    if(i === n){
        b.x = car.position.x; b.z = car.position.z;
        b.fx = -Math.sin(physics.yaw); b.fz = -Math.cos(physics.yaw);
        playerWorldVelocity(aiContactVel);
        b.vx = aiContactVel.x; b.vz = aiContactVel.z;
    }else{
        const c = aiCars[i];
        const s = trackSamples[c.trackIndex];
        b.x = c.x; b.z = c.z;
        b.fx = -Math.sin(c.yaw); b.fz = -Math.cos(c.yaw);
        b.vx = b.fx * c.u + s.rx * c.latKick;
        b.vz = b.fz * c.u + s.rz * c.latKick;
    }
    b.dirty = false;
}

/** 월드 변위/속도 변화를 차량 상태에 반영 */
function aiApplyContact(i, n, px, pz, dvx, dvz, hard){
    if(i === n){
        car.position.x += px;
        car.position.z += pz;
        if(dvx !== 0 || dvz !== 0) applyPlayerImpulse(dvx, dvz);
        if(hard) physics.wallHit = Math.min(1, physics.wallHit + .3);
        const b = aiContactBody[i];
        b.x = car.position.x; b.z = car.position.z;
        return;
    }
    const c = aiCars[i];
    const s = trackSamples[c.trackIndex];
    const along = px * s.tx + pz * s.tz;
    const side = px * s.rx + pz * s.rz;
    c.progress += along / SAMPLE_SPACING;
    let lat = c.lateral + side;
    lat = Math.max(-AI_LAT_HARD, Math.min(AI_LAT_HARD, lat));
    // 밀린 위치를 그대로 새 오프셋으로 (도로 끝 너머의 '의도'는 버린다)
    c.offset = lat - aiArrayAt(aiLineLat, c.progress);
    c.lateral = lat;
    c.u = Math.max(0, c.u + dvx * s.tx + dvz * s.tz);
    c.latKick = Math.max(-4, Math.min(4, c.latKick + (dvx * s.rx + dvz * s.rz)));
    placeAICar(c, 0);
    const b = aiContactBody[i];
    b.x = c.x; b.z = c.z;
    b.dirty = true;
}

function resolveCarContacts(){
    const n = aiCars.length;
    if(n === 0) return;
    const hasPlayer = typeof physics !== "undefined" && typeof car !== "undefined";
    const total = hasPlayer ? n + 1 : n;
    for(let i = 0; i < total; i++) aiLoadContactBody(i, n);

    const R = AI_CIRCLE_RADIUS, L = AI_CIRCLE_OFFSET;
    const reach = 2 * (L + R);
    for(let iter = 0; iter < 2; iter++){
        for(let i = 0; i < total; i++){
            for(let j = i + 1; j < total; j++){
                const A = aiContactBody[i], B = aiContactBody[j];
                let dx = B.x - A.x, dz = B.z - A.z;
                if(dx * dx + dz * dz > reach * reach) continue;
                // 가장 깊게 겹친 원 쌍
                let best = 0, nx = 0, nz = 0;
                for(let sa = -1; sa <= 1; sa += 2){
                    const ax = A.x + A.fx * L * sa, az = A.z + A.fz * L * sa;
                    for(let sb = -1; sb <= 1; sb += 2){
                        const bx = B.x + B.fx * L * sb, bz = B.z + B.fz * L * sb;
                        const ex = bx - ax, ez = bz - az;
                        const d2 = ex * ex + ez * ez;
                        if(d2 >= 4 * R * R) continue;
                        const d = Math.sqrt(d2);
                        const pen = 2 * R - d;
                        if(pen > best){
                            best = pen;
                            if(d > 1e-4){ nx = ex / d; nz = ez / d; }
                            else{ const dd = Math.hypot(dx, dz) || 1; nx = dx / dd; nz = dz / dd; }
                        }
                    }
                }
                if(best <= 0) continue;
                // 겹침 해소 (같은 질량 → 반씩)
                const push = best * .5 + .002;
                // 법선 방향 상대 속도 교환
                const vrel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
                let jimp = 0;
                if(vrel < 0){
                    jimp = -(1 + AI_RESTITUTION) * vrel * .5;
                    A.vx -= jimp * nx; A.vz -= jimp * nz;
                    B.vx += jimp * nx; B.vz += jimp * nz;
                }
                const hard = vrel < -1;
                if(hard && iter === 0) aiContactCount++;
                aiApplyContact(i, n, -nx * push, -nz * push, -jimp * nx, -jimp * nz, hard);
                aiApplyContact(j, n, nx * push, nz * push, jimp * nx, jimp * nz, hard);
            }
        }
    }
    for(let i = 0; i < n; i++){
        if(aiContactBody[i].dirty) renderAICar(aiCars[i]);
    }
}

/* ---------------------------------------------------------
   순위
   반환 배열과 항목 객체는 재사용된다 (호출 사이에 보관하지 말 것).
   항목: name, code, color, isPlayer, progress, lap, finished, finishTime, bestLap,
         gapToLeader (s), lapsDown, interval (앞 차와의 간격, s)
--------------------------------------------------------- */
const aiStandingsOut = [];
const aiStandingsPool = [];
for(let i = 0; i < AI_MAX_BODIES; i++){
    aiStandingsPool.push({
        name: "", code: "", color: 0, team: "", isPlayer: false, progress: 0, lap: 1,
        finished: false, finishTime: 0, bestLap: 0, lastLap: 0, gapToLeader: 0, lapsDown: 0, interval: 0,
        sortKey: 0, car: null
    });
}

function aiCompareStanding(a, b){
    if(a.finished !== b.finished) return a.finished ? -1 : 1;
    if(a.finished) return a.finishTime - b.finishTime;
    return b.sortKey - a.sortKey;
}

function aiRaceClockNow(){
    if(race.state === "racing") return race.time;
    return Math.max(aiClock, race.time);
}

function getRaceStandings(){
    aiStandingsOut.length = 0;
    const n = aiCars.length;
    for(let i = 0; i < n; i++){
        const c = aiCars[i];
        const e = aiStandingsPool[i];
        e.name = c.name; e.code = c.code; e.color = c.color; e.team = c.team;
        e.isPlayer = false; e.car = c;
        e.progress = c.progress; e.sortKey = c.progress;
        e.lap = c.lap;
        e.finished = c.finished; e.finishTime = c.finishTime;
        e.bestLap = c.bestLap; e.lastLap = c.lastLap;
        aiStandingsOut.push(e);
    }
    if(typeof physics !== "undefined"){
        const e = aiStandingsPool[n];
        if(n > 0 && race.state !== "idle") aiRefreshPlayer();
        e.name = "YOU"; e.code = "YOU"; e.color = 0xc8101e; e.team = "";
        e.isPlayer = true; e.car = null;
        e.progress = physics.progress;
        e.sortKey = n > 0 ? aiPlayer.progress : physics.progress;
        e.lap = race.lap;
        e.finished = race.state === "finished";
        e.finishTime = e.finished ? race.time : 0;
        e.bestLap = race.bestLap; e.lastLap = race.lastLap;
        aiStandingsOut.push(e);
    }
    aiStandingsOut.sort(aiCompareStanding);

    // 간격 (s): 완주자는 기록 차, 미완주자는 기준 랩 시간축으로 추정
    const N = SAMPLE_COUNT;
    const leader = aiStandingsOut[0];
    const now = aiRaceClockNow();
    const haveRef = aiRefCum !== null;
    const finishP = raceSettings.laps * N;
    for(let i = 0; i < aiStandingsOut.length; i++){
        const e = aiStandingsOut[i];
        e.lapsDown = 0;
        if(i === 0 || !leader){
            e.gapToLeader = 0;
        }else if(e.finished){
            e.gapToLeader = e.finishTime - leader.finishTime;
        }else if(leader.finished){
            e.gapToLeader = haveRef ? Math.max(0, now + aiRefTimeAt(finishP) - aiRefTimeAt(e.sortKey) - leader.finishTime) : 0;
            e.lapsDown = Math.max(0, Math.floor((finishP - e.sortKey) / N));
        }else{
            e.gapToLeader = haveRef ? Math.max(0, aiRefTimeAt(leader.sortKey) - aiRefTimeAt(e.sortKey)) : 0;
            e.lapsDown = Math.max(0, Math.floor((leader.sortKey - e.sortKey) / N));
        }
        e.interval = i === 0 ? 0 : Math.max(0, e.gapToLeader - aiStandingsOut[i - 1].gapToLeader);
    }
    return aiStandingsOut;
}

/** 플레이어 순위 (1부터). AI 가 없으면 1 */
function aiPlayerPosition(){
    const list = getRaceStandings();
    for(let i = 0; i < list.length; i++) if(list[i].isPlayer) return i + 1;
    return 1;
}

/**
 * 앞쪽에서 가장 가까운 AI 차 (트랙 거리 기준, maxDist m 이내).
 * lateral 을 주면 횡간격 3 m 이내인 차만. 없으면 null
 */
function aiCarAhead(progress, lateral, maxDist = 200){
    let best = null, bestD = maxDist;
    const checkLat = typeof lateral === "number";
    for(let i = 0; i < aiCars.length; i++){
        const c = aiCars[i];
        const d = aiTrackGap(progress, c.progress);
        if(d <= 0 || d >= bestD) continue;
        if(checkLat && Math.abs(c.lateral - lateral) > 3) continue;
        best = c; bestD = d;
    }
    return best;
}
