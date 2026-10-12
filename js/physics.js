/* =========================================================
   VEHICLE PHYSICS — 2026 F1 (게임성과 타협한 실시간 모델)

   승인된 항목 (docs/PHYSICS_PROPOSAL.md)
    1  2026 제원: 768 kg + 연료, 휠베이스 3.4 m, 18" 타이어(반경 0.36 m)
    2  다운포스 기반 코너링 한계: 타이어 한계 = μ(Fz) · (mg + ½ρ·ClA·v²)
    3  타이어 마찰원: √(Fx² + Fy²) ≤ μ·Fz  (제동/가속 중에는 횡그립 감소)
    4  액티브 에어로 X/Z 모드: 지정 직선 구간에서 저항·다운포스 감소
    5  파워유닛: ICE ≈400 kW + MGU-K 350 kW (속도별 테이퍼),
       배터리 4 MJ, 랩당 회수 8.5 MJ, 오버테이크 모드(1초 이내 +0.5 MJ, 337 km/h까지 350 kW)
    6  하중 이동: 종방향(제동 시 앞 하중↑) → 앞뒤 그립 배분, 피치·롤 시각화
    7  노면별 그립: 아스팔트 / 연석 / 잔디 / 자갈
    8  슬립 각 기반 자전거 모델 + 간이 Pacejka → 언더/오버스티어, 스핀
       (보조: 트랙션 컨트롤, ABS, 스핀 방지 ESP — 난이도 프리셋)
    9  타이어 온도·마모 (컴파운드별 적정 온도 창)
   10  브레이크 락업 (ABS 끔) → 직진, 플랫 스팟
   11  슬립스트림 / 더티 에어 (앞차 뒤 항력·다운포스 감소)
   12  연료 소모에 따른 질량 감소
   13  그라운드 이펙트 · 차고 · 포퍼싱 (힙 스프링-댐퍼)

   좌표: 차체 기준 u = 전진 속도, v = 왼쪽 횡속도, r = yaw rate(+좌회전)
   단위: kg, m, s, N, W
========================================================= */
"use strict";

const G = 9.81;

const VEHICLE = {
    dryMass: 768,              // 2026 최저 중량 (드라이버 포함, 연료 제외)
    wheelBase: CAR_SPEC.wheelBase,
    cgToFront: 1.87,           // 무게 배분 약 45 : 55
    cgToRear: 1.53,
    cgHeight: .29,
    trackWidth: 1.6,
    yawInertiaPerKg: 1.45,     // Iz ≈ 1150 kg·m²
    tireRadius: CAR_SPEC.tireRadius,

    mu: 1.72,                  // 드라이 슬릭 피크 마찰계수
    loadSensitivity: .10,      // 하중이 커질수록 μ 가 약간 감소
    refLoad: 4000,             // N / 타이어
    pacejkaB: 18,              // 앞: 피크 슬립각 ≈ 0.10 rad (≈ 6°)
    pacejkaBRear: 16.5,        // 뒤: 피크가 조금 늦어 한계에서 점진적으로 미끄러짐
    pacejkaC: 1.45,            // 피크 이후 미끄럼 마찰 ≈ 75% 유지
    rearGripBias: 1.18,        // 리어 타이어 폭(405→375mm)이 프론트보다 넓어 그립↑ → 한계에서 언더스티어(안정)
    slideFactor: .82,          // 락업/휠스핀 시 미끄럼 마찰 비율

    brakeMaxForce: 52000,
    brakeBias: .57,
    drivetrainEfficiency: .94,
    rollingCoef: .012,

    fuelLHV: 43e6,             // J/kg
    iceEfficiency: .47,        // 2026 ICE 열효율 (지속가능 연료)
    fuelPerLapEstimate: 1.5    // kg — 시작 연료 계산용 (+ 여유분)
};

// 액티브 에어로 두 모드 (2025 대비 다운포스 ~30%↓, X 모드 항력 대폭↓)
const AERO_MODES = {
    Z: {CdA: 1.05, ClA: 3.2, balance: .40},
    X: {CdA: .68,  ClA: 1.75, balance: .36}
};
const AERO_SWITCH_TIME = .35;  // 플랩 전환 시간 (s)

const POWER_UNIT = {
    mgukMaxKW: 350,
    esCapacity: 4e6,           // 배터리 사용 가능 에너지 (J)
    harvestPerLap: 8.5e6,      // 랩당 회수 한도 (J)
    overrideExtra: .5e6,       // 오버테이크 모드 추가 회수 (J)
    liftHarvestKW: 150,        // 가속 페달을 뗐을 때 회수 출력
    idleRPM: 4000,
    maxRPM: 15000,
    upshiftRPM: 12300,
    downshiftRPM: 9300,
    launchRPM: 8500,
    torqueScale: .565          // 기존 토크 곡선을 ICE ≈400 kW 로 축소
};

const TYRE_COMPOUNDS = {
    soft:   {label: "SOFT",   color: "#e3262b", mu: 1.04,  optimum: 95,  window: 26, wear: 1.8},
    medium: {label: "MEDIUM", color: "#f2c200", mu: 1.0,   optimum: 100, window: 28, wear: 1.0},
    hard:   {label: "HARD",   color: "#f0f0f0", mu: .965,  optimum: 106, window: 30, wear: .6}
};
const TYRE_AMBIENT = 28;
const TYRE_BLANKET = 70;       // 2026 타이어 블랭킷 온도
const TYRE_HEAT_CAPACITY = 1200;   // J/K (표면+카커스 등가)
const TYRE_HEAT_SHARE = .075;      // 슬립 일률 중 타이어로 가는 비율
const TYRE_WEAR_PER_J = 4.2e-8;

const SURFACES = {
    asphalt: {mu: 1.0,  rolling: 1,   aero: 1,  label: "DRY ASPHALT"},
    kerb:    {mu: .9,   rolling: 1.6, aero: 1,  label: "KERB"},
    grass:   {mu: .38,  rolling: 4.5, aero: 1,  label: "GRASS"},
    gravel:  {mu: .5,   rolling: 14,  aero: 1,  label: "GRAVEL"}
};

// 2026 규정의 MGU-K 속도별 출력 한계 (kW)
function mgukPowerLimitKW(kmh, override){
    if(override){
        if(kmh <= 337) return 350;
        return Math.max(0, Math.min(350, 7100 - 20 * kmh));
    }
    if(kmh <= 290) return 350;
    if(kmh < 340) return 1800 - 5 * kmh;
    return Math.max(0, 6900 - 20 * kmh);
}

const physics = {
    /* 기존 HUD/카메라 호환 필드 */
    speed: 0,
    gear: 0,
    engineRPM: 4000,
    idleRPM: POWER_UNIT.idleRPM,
    engineMaxRPM: 13000,
    steering: 0,
    yaw: 0,
    reverse: false,
    brakePressure: 0,
    surface: "asphalt",
    onKerb: false,
    trackIndex: 0,
    lateral: 0,
    wallHit: 0,

    /* 동역학 상태 */
    u: 0, v: 0, r: 0,
    ax: 0, ay: 0,
    mass: VEHICLE.dryMass,
    progress: 0,               // 누적 진행 샘플 (출발선 = 0, 랩마다 +SAMPLE_COUNT)

    /* 파워트레인 */
    gears: [4.33, 3.75, 3.25, 2.81, 2.44, 2.11, 1.83, 1.58],
    finalDrive: 3.0,
    reverseRatio: 4.4,
    reverseMaxSpeed: 8,
    throttle: 0,
    iceKW: 0,

    /* ERS */
    ersEnergy: 3.4e6,
    ersDeployKW: 0,
    ersHarvestKW: 0,
    harvestedThisLap: 0,
    overrideArmed: false,
    overrideActive: false,
    overrideEnergy: 0,

    /* 에어로 */
    aeroMode: "Z",
    aeroBlend: 0,              // 0 = Z, 1 = X
    aeroManualX: false,
    inAeroZone: false,
    downforce: 0,
    dragForce: 0,
    slipstream: 0,             // 0..1 (항력 감소 정도)
    dirtyAir: 0,               // 0..1 (다운포스 손실 정도)

    /* 타이어 [FL, FR, RL, RR] */
    compound: "medium",
    tyreTemp: [TYRE_BLANKET, TYRE_BLANKET, TYRE_BLANKET, TYRE_BLANKET],
    tyreWear: [0, 0, 0, 0],
    flatSpot: [0, 0],          // 앞, 뒤 축
    lockFront: false,
    lockRear: false,
    wheelspin: false,
    absActive: false,
    tcActive: false,
    escActive: false,
    slipAngleFront: 0,
    slipAngleRear: 0,

    /* 연료 */
    fuel: 0,
    fuelStart: 0,

    /* 서스펜션 / 차고 */
    heave: 0,                  // 압축량 (m, + = 내려감)
    heaveVel: 0,
    rideHeight: .045,
    pitch: 0,
    roll: 0,
    porpoise: 0,               // 최근 진동 크기 (시각/HUD)

    /* 노면 */
    surfaceMu: 1,
    surfaceRolling: 1
};

const RIDE_HEIGHT_STATIC = .045;
const HEAVE_STIFFNESS = 650000;    // N/m
const HEAVE_DAMPING_RATIO = .16;
const FLOOR_STALL_HEIGHT = .012;
const GROUND_EFFECT_GAIN = .15;    // 2026: 부분 평면 플로어 → 그라운드 이펙트 축소

/* =========================================================
   ENGINE TORQUE CURVE (기존 곡선 형태 유지, 2026 ICE 출력으로 스케일)
========================================================= */
const TORQUE_CURVE = [
    [5000, 430], [6500, 500], [8000, 560], [9500, 575],
    [11000, 565], [12500, 535], [13800, 490], [15000, 420]
];

function getEngineTorque(rpm){
    const points = TORQUE_CURVE;
    let t;
    if(rpm <= points[0][0]) t = points[0][1];
    else if(rpm >= points[points.length - 1][0]) t = points[points.length - 1][1];
    else{
        for(let i = 0; i < points.length - 1; i++){
            const a = points[i], b = points[i + 1];
            if(rpm >= a[0] && rpm <= b[0]){
                t = a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]);
                break;
            }
        }
    }
    return t * POWER_UNIT.torqueScale;
}

/* =========================================================
   TYRE MODEL
========================================================= */
function pacejka(alpha, B){
    return Math.sin(VEHICLE.pacejkaC * Math.atan(B * alpha));
}

/** 컴파운드 적정 온도 창과 마모를 반영한 그립 배율 */
function tyreGripFactor(temp, wear, flat){
    const c = TYRE_COMPOUNDS[physics.compound];
    const d = (temp - c.optimum) / c.window;
    let g = 1 - .12 * d * d;
    g = Math.max(.8, Math.min(1, g));
    let w = 1 - .14 * wear;
    if(wear > .75) w -= .5 * (wear - .75);          // 마모 절벽
    return g * Math.max(.55, w) * (1 - flat * .03) * c.mu;
}

function axleGrip(axle){
    const i = axle * 2;
    return (tyreGripFactor(physics.tyreTemp[i], physics.tyreWear[i], physics.flatSpot[axle]) +
            tyreGripFactor(physics.tyreTemp[i + 1], physics.tyreWear[i + 1], physics.flatSpot[axle])) * .5;
}

/** 하중 민감도를 반영한 축 마찰계수 */
function axleMu(Fz, axle){
    const perTyre = Fz / 2;
    const sens = 1 - VEHICLE.loadSensitivity * (perTyre / VEHICLE.refLoad - 1);
    return VEHICLE.mu * Math.max(.75, Math.min(1.1, sens)) * physics.surfaceMu * axleGrip(axle) * (axle === 1 ? VEHICLE.rearGripBias : 1);
}

/* =========================================================
   SURFACE
========================================================= */
function updateSurface(){
    const q = queryTrack(car.position.x, car.position.z, physics.trackIndex);
    // 누적 진행 (랩 계산/순위/슬립스트림 공용)
    let d = q.index - physics.trackIndex;
    if(d > SAMPLE_COUNT / 2) d -= SAMPLE_COUNT;
    if(d < -SAMPLE_COUNT / 2) d += SAMPLE_COUNT;
    physics.progress += d;
    physics.trackIndex = q.index;
    physics.lateral = q.lateral;

    const half = ROAD_WIDTH / 2;
    const sideIdx = q.lateral >= 0 ? 0 : 1;
    let surface = "grass";
    if(q.dist <= half) surface = "asphalt";
    else if(q.dist <= half + KERB_WIDTH && kerbMask[sideIdx][q.index]) surface = "kerb";
    else if(q.dist <= WALL_OFFSET - .8 && gravelMask[sideIdx][q.index]) surface = "gravel";

    physics.surface = surface;
    physics.onKerb = surface === "kerb";
    const s = SURFACES[surface];
    physics.surfaceMu = s.mu;
    physics.surfaceRolling = s.rolling;
}

/* =========================================================
   ACTIVE AERO (X / Z MODE)
========================================================= */
function updateAeroMode(dt, throttle, brake){
    physics.inAeroZone = aeroZoneMask[physics.trackIndex] === 1;
    let wantX = physics.inAeroZone && !brake && physics.u > 25 && physics.surface !== "grass" && physics.surface !== "gravel";
    if(!raceSettings.aeroAuto) wantX = wantX && physics.aeroManualX;
    // 조향을 크게 하면 코너 모드로 복귀
    if(Math.abs(physics.steering) > .06) wantX = false;
    if(!physics.inAeroZone || brake) physics.aeroManualX = false;

    physics.aeroMode = wantX ? "X" : "Z";
    const target = wantX ? 1 : 0;
    const step = dt / AERO_SWITCH_TIME;
    physics.aeroBlend += Math.max(-step, Math.min(step, target - physics.aeroBlend));
}

function toggleManualAero(){
    if(raceSettings.aeroAuto) return;
    if(physics.inAeroZone) physics.aeroManualX = !physics.aeroManualX;
}

/* =========================================================
   OTHER CARS — 슬립스트림 / 더티 에어 / 오버테이크 판정
   (ai.js 가 aiCars 를 제공하지 않으면 영향 없음)
========================================================= */
function otherCars(){
    return (typeof aiCars !== "undefined" && aiCars) ? aiCars : [];
}

/**
 * progress/lateral 기준으로 앞차의 후류 효과를 계산한다.
 * 반환: {tow: 0..1 (항력 감소), dirty: 0..1 (다운포스 손실), gapAhead: 앞차까지 m}
 */
const wakeResult = {tow: 0, dirty: 0, gapAhead: Infinity};
function computeWake(progress, lateral, self){
    wakeResult.tow = 0;
    wakeResult.dirty = 0;
    wakeResult.gapAhead = Infinity;
    const cars = otherCars();
    const consider = (p, lat) => {
        const d = (p - progress) * SAMPLE_SPACING;
        if(d <= 0) return;
        if(d < wakeResult.gapAhead) wakeResult.gapAhead = d;
        if(d > 80) return;
        const latDiff = Math.abs(lat - lateral);
        if(latDiff > 3) return;
        const align = 1 - latDiff / 3;
        wakeResult.tow = Math.max(wakeResult.tow, Math.pow(1 - d / 80, 1.4) * align);
        if(d < 45) wakeResult.dirty = Math.max(wakeResult.dirty, (1 - d / 45) * align);
    };
    for(const c of cars){
        if(c === self) continue;
        consider(c.progress, c.lateral);
    }
    if(self && self !== physics){
        consider(physics.progress, physics.lateral);
    }
    return wakeResult;
}

/** 오버테이크 모드: 판정 지점(에어로 구간 시작)에서 앞차와 1초 이내면 활성 가능 */
let lastDetectionZone = -1;
function updateOverride(dt, throttle){
    const idx = physics.trackIndex;
    for(let z = 0; z < aeroZones.length; z++){
        const zs = aeroZones[z].start;
        let d = idx - zs;
        if(d < 0) d += SAMPLE_COUNT;
        if(d < 4 && lastDetectionZone !== z){
            lastDetectionZone = z;
            const gapSeconds = wakeResult.gapAhead / Math.max(10, physics.u);
            physics.overrideArmed = gapSeconds <= 1.0;
            if(physics.overrideArmed){
                physics.overrideEnergy = POWER_UNIT.overrideExtra;
                if(typeof onOverrideArmed === "function") onOverrideArmed();
            }
        }
    }
    physics.overrideActive = physics.overrideArmed && Input.boost && throttle && physics.ersEnergy > 0;
}

/* =========================================================
   GEARBOX / ENGINE
========================================================= */
function wheelRPM(){
    return Math.abs(physics.u) / (2 * Math.PI * VEHICLE.tireRadius) * 60;
}

function updateGearbox(throttle){
    if(physics.reverse){
        physics.engineRPM = Math.max(POWER_UNIT.idleRPM, wheelRPM() * physics.reverseRatio * physics.finalDrive);
        return;
    }
    if(physics.gear <= 0){
        physics.engineRPM += ((throttle ? 9000 : POWER_UNIT.idleRPM) - physics.engineRPM) * .1;
        return;
    }
    let rpm = wheelRPM() * physics.gears[physics.gear - 1] * physics.finalDrive;
    // 1단 출발: 클러치 슬립으로 회전수 유지
    if(physics.gear === 1 && throttle) rpm = Math.max(rpm, POWER_UNIT.launchRPM);
    physics.engineRPM = Math.max(POWER_UNIT.idleRPM, Math.min(POWER_UNIT.maxRPM, rpm));

    if(physics.engineRPM > POWER_UNIT.upshiftRPM && physics.gear < physics.gears.length){
        physics.gear++;
    }else if(physics.gear > 1){
        const lower = wheelRPM() * physics.gears[physics.gear - 2] * physics.finalDrive;
        if(physics.engineRPM < POWER_UNIT.downshiftRPM && lower < POWER_UNIT.upshiftRPM - 400) physics.gear--;
    }
}

/** 후륜 구동력 요구치 (N). ICE + MGU-K. ERS 에너지/연료 소비는 적분 단계에서 처리 */
function computeDriveDemand(throttle){
    physics.iceKW = 0;
    physics.ersDeployKW = 0;
    physics.iceShare = 1;
    if(!throttle) return 0;
    const absU = Math.abs(physics.u);
    const rpm = physics.engineRPM;
    const torque = getEngineTorque(rpm);

    if(physics.reverse){
        physics.iceKW = torque * rpm * Math.PI / 30 / 1000 * .3;
        return -torque * physics.reverseRatio * physics.finalDrive * VEHICLE.drivetrainEfficiency / VEHICLE.tireRadius;
    }
    if(physics.gear < 1) return 0;

    const ratio = physics.gears[physics.gear - 1] * physics.finalDrive;
    // 연료가 바닥나면 보호 모드(ICE 25%)로 피트까지 굴러갈 수 있게 한다
    const fuelScale = physics.fuel > 0 ? 1 : .25;
    const iceForce = torque * ratio * VEHICLE.drivetrainEfficiency / VEHICLE.tireRadius * fuelScale;
    physics.iceKW = torque * rpm * Math.PI / 30 / 1000 * fuelScale;

    let ersForce = 0;
    if(physics.ersEnergy > 0){
        const kmh = absU * 3.6;
        const limit = mgukPowerLimitKW(kmh, physics.overrideActive);
        physics.ersDeployKW = limit;
        // 저속에서는 MGU-K 토크 한계로 제한
        ersForce = Math.min(9000, limit * 1000 / Math.max(absU, 6));
    }
    physics.iceShare = iceForce / Math.max(1, iceForce + ersForce);
    return iceForce + ersForce;
}

/* =========================================================
   CAR UPDATE
========================================================= */
const SUBSTEPS = 4;
const tmpForces = {Fyf: 0, Fyr: 0, Fxf: 0, Fxr: 0, alphaF: 0, alphaR: 0};

function updateCar(dt, controlsLocked){
    const throttle = !controlsLocked && Input.throttle;
    const brakeInput = controlsLocked ? true : Input.brake;
    const assists = currentAssists();

    updateSurface();
    updateAeroMode(dt, throttle, brakeInput);

    // 다른 차의 후류
    const wake = computeWake(physics.progress, physics.lateral, physics);
    physics.slipstream += (wake.tow - physics.slipstream) * Math.min(1, dt * 4);
    physics.dirtyAir += (wake.dirty - physics.dirtyAir) * Math.min(1, dt * 4);
    updateOverride(dt, throttle);

    /* FORWARD / REVERSE STATE (기존 조작 방식 유지)
       가속: 전진,  브레이크: 감속 → 완전히 멈춘 뒤 후진 */
    const u0 = physics.u;
    if(throttle){
        physics.reverse = false;
        if(u0 < -.15) physics.gear = 0;
        else if(physics.gear <= 0) physics.gear = 1;
    }else if(brakeInput && u0 <= .15 && !controlsLocked){
        physics.reverse = true;
        physics.gear = -1;
    }else if(!brakeInput && physics.reverse && Math.abs(u0) < .08){
        physics.reverse = false;
        physics.gear = 0;
    }

    updateGearbox(throttle);

    // 페달 → 제동 압력 (램프)
    const forwardBraking = brakeInput && u0 > .08 && !physics.reverse;
    const reverseBraking = throttle && u0 < -.08;
    const brakeTarget = (forwardBraking || reverseBraking) ? 1 : 0;
    const rate = brakeTarget > physics.brakePressure ? 8.5 : 11.0;
    physics.brakePressure += (brakeTarget - physics.brakePressure) * Math.min(1, rate * dt);

    const driving = !forwardBraking && !reverseBraking && !controlsLocked && (throttle || (physics.reverse && brakeInput));
    let driveDemand = driving ? computeDriveDemand(true) : (computeDriveDemand(false), 0);

    /* 조향: 속도 감응형 최대 조향각
       현재 타이어+다운포스로 낼 수 있는 최대 횡가속(a_max)에 필요한 조향각의 약 1.6배까지만 허용.
       → 키보드(디지털)나 기울기를 끝까지 꺾어도 한계 근처에서 조작되고,
         그 이상은 슬립 각이 커져 언더스티어로 나타난다. */
    const absU = Math.abs(physics.u);
    const qd = .5 * 1.2 * absU * absU * (AERO_MODES.Z.ClA + (AERO_MODES.X.ClA - AERO_MODES.Z.ClA) * physics.aeroBlend);
    const aMax = (physics.mass * G + qd) * VEHICLE.mu * physics.surfaceMu / physics.mass;
    const deltaMax = Math.min(.32, 1.6 * VEHICLE.wheelBase * aMax / Math.max(1, absU * absU)) + .004;
    physics.deltaMax = deltaMax;
    let steerResponse = 9 - Math.min(1, absU / 80) * 4.5;
    physics.steering += (Input.steer * deltaMax - physics.steering) * Math.min(1, steerResponse * dt);

    /* --- 서브스텝 적분 --- */
    const h = dt / SUBSTEPS;
    let harvestJ = 0, deployJ = 0, fuelJ = 0;
    physics.absActive = physics.tcActive = physics.escActive = false;
    physics.lockFront = physics.lockRear = physics.wheelspin = false;

    for(let s = 0; s < SUBSTEPS; s++){
        const res = integrateDynamics(h, driveDemand, assists, throttle);
        harvestJ += res.harvest;
        deployJ += res.deploy;
        fuelJ += res.fuelJ;
    }

    /* ERS 에너지 */
    const harvestCap = POWER_UNIT.harvestPerLap + (physics.overrideArmed ? physics.overrideEnergy : 0);
    harvestJ = Math.min(harvestJ, Math.max(0, harvestCap - physics.harvestedThisLap));
    physics.harvestedThisLap += harvestJ;
    physics.ersEnergy = Math.max(0, Math.min(POWER_UNIT.esCapacity, physics.ersEnergy + harvestJ * .9 - deployJ));
    physics.ersHarvestKW = harvestJ / dt / 1000;
    if(physics.ersEnergy <= 0) physics.overrideActive = false;

    /* 연료 (ICE 가 낸 일 / (열효율 × 발열량)) → 질량 감소 */
    physics.fuel = Math.max(0, physics.fuel - fuelJ / (VEHICLE.iceEfficiency * VEHICLE.fuelLHV));
    physics.mass = VEHICLE.dryMass + physics.fuel;

    /* 위치 이동 */
    const fx = -Math.sin(physics.yaw), fz = -Math.cos(physics.yaw);
    const lx = -Math.cos(physics.yaw), lz = Math.sin(physics.yaw);
    car.position.x += (fx * physics.u + lx * physics.v) * dt;
    car.position.z += (fz * physics.u + lz * physics.v) * dt;
    car.rotation.y = physics.yaw;
    physics.speed = physics.u;

    resolveWallCollision();
    physics.wallHit = Math.max(0, physics.wallHit - dt * 2.5);

    updateSuspension(dt);
    updateTyres(dt);
}

/** 한 서브스텝의 자전거 모델 적분. 반환: 이 스텝의 회수/방출 에너지 (J) */
const stepEnergy = {harvest: 0, deploy: 0};
function integrateDynamics(h, driveDemand, assists, throttle){
    const V = VEHICLE;
    const m = physics.mass;
    const Iz = m * V.yawInertiaPerKg;
    const L = V.wheelBase, a = V.cgToFront, b = V.cgToRear;
    let u = physics.u, v = physics.v, r = physics.r;
    const absU = Math.abs(u);
    const dir = u >= 0 ? 1 : -1;
    const delta = physics.steering;

    /* 공력: 모드 블렌드 + 그라운드 이펙트 + 후류 */
    const X = AERO_MODES.X, Z = AERO_MODES.Z, k = physics.aeroBlend;
    const CdA = Z.CdA + (X.CdA - Z.CdA) * k;
    const ClA = Z.ClA + (X.ClA - Z.ClA) * k;
    const balance = Z.balance + (X.balance - Z.balance) * k;
    const qd = .5 * 1.2 * u * u;
    const ge = groundEffectFactor(physics.rideHeight);
    const downforce = qd * ClA * ge * (1 - .16 * physics.dirtyAir);
    const drag = qd * CdA * (1 - .32 * physics.slipstream) + qd * .08 * (ge - 1);
    physics.downforce = downforce;
    physics.dragForce = drag;

    /* 수직 하중 + 종방향 하중 이동 */
    const transfer = m * physics.ax * V.cgHeight / L;
    let Fzf = m * G * b / L + downforce * balance - transfer;
    let Fzr = m * G * a / L + downforce * (1 - balance) + transfer;
    Fzf = Math.max(Fzf, m * G * .12);
    Fzr = Math.max(Fzr, m * G * .12);

    const FmaxF = axleMu(Fzf, 0) * Fzf;
    const FmaxR = axleMu(Fzr, 1) * Fzr;

    /* 종방향 힘: 제동 + 구동 */
    const brakeTotal = physics.brakePressure * V.brakeMaxForce * (physics.reverse ? .4 : 1);
    let Fbf = brakeTotal * V.brakeBias;
    let Fbr = brakeTotal * (1 - V.brakeBias);
    let latScaleF = 1, latScaleR = 1;
    let FxF, FxR;

    // TC/ABS 는 직전 스텝의 횡력을 고려해 마찰원 안쪽에 종방향 힘을 맞춘다
    // (조향 중에도 횡그립을 남겨 둔다 — 실제 슬립률 제어와 같은 효과)
    const longCapF = Math.sqrt(Math.max(0, (FmaxF * .95) * (FmaxF * .95) - tmpForces.Fyf * tmpForces.Fyf));
    const longCapR = Math.sqrt(Math.max(0, (FmaxR * .92) * (FmaxR * .92) - tmpForces.Fyr * tmpForces.Fyr));

    // 앞축: 제동만
    if(assists.abs && Fbf > longCapF && absU > 1){
        Fbf = longCapF; physics.absActive = true;
    }else if(Fbf > FmaxF * .98 && absU > 1){
        if(assists.abs){ Fbf = FmaxF * .97; physics.absActive = true; }
        else{ Fbf = FmaxF * V.slideFactor; latScaleF = .18; physics.lockFront = true; }
    }
    FxF = -dir * Fbf;

    // 뒤축: 구동 - 제동
    let rearDemand = driveDemand - dir * Fbr;
    let usedDrive = driveDemand;
    if(assists.tc && driveDemand !== 0 && Math.sign(rearDemand) === Math.sign(driveDemand) && Math.abs(rearDemand) > longCapR){
        rearDemand = Math.sign(rearDemand) * longCapR; usedDrive = rearDemand; physics.tcActive = true;
    }else if(assists.abs && driveDemand === 0 && Math.abs(rearDemand) > longCapR && absU > 1){
        rearDemand = Math.sign(rearDemand) * longCapR; physics.absActive = true;
    }else if(Math.abs(rearDemand) > FmaxR * .98 && (absU > 1 || driveDemand !== 0)){
        const sign = Math.sign(rearDemand);
        if(driveDemand !== 0 && sign === Math.sign(driveDemand)){
            if(assists.tc){ rearDemand = sign * FmaxR * .95; physics.tcActive = true; }
            else{ rearDemand = sign * FmaxR * V.slideFactor; latScaleR = .3; physics.wheelspin = true; }
            usedDrive = rearDemand;
        }else{
            if(assists.abs){ rearDemand = sign * FmaxR * .97; physics.absActive = true; }
            else{ rearDemand = sign * FmaxR * V.slideFactor; latScaleR = .2; physics.lockRear = true; }
        }
    }
    FxR = rearDemand;

    /* 마찰원: 남은 횡그립 */
    const capF = Math.sqrt(Math.max(0, FmaxF * FmaxF - FxF * FxF)) * latScaleF;
    const capR = Math.sqrt(Math.max(0, FmaxR * FmaxR - FxR * FxR)) * latScaleR;

    /* 슬립 각 (u 가 작을 때는 운동학 모델과 블렌드) */
    const uu = Math.max(absU, 1);
    const alphaF = delta - Math.atan2(v + a * r, uu);
    const alphaR = -Math.atan2(v - b * r, uu);
    const FyF = capF * pacejka(alphaF, V.pacejkaB);
    const FyR = capR * pacejka(alphaR, V.pacejkaBRear);

    /* 저항 */
    const rolling = V.rollingCoef * physics.surfaceRolling * (m * G + downforce * .3);
    let surfaceDrag = 0;
    if(physics.surface === "grass"){
        // 기존 잔디 특성 유지: 약 202 km/h 부근에서 부드럽게 제한
        surfaceDrag = 260 + Math.max(0, absU - 54.7) * 900;
    }else if(physics.surface === "gravel"){
        surfaceDrag = m * G * .25 * Math.min(1, absU / 8);
    }
    // 오프 스로틀 회수 (MGU-K 엔진 브레이크)
    let liftForce = 0;
    const canHarvest = physics.harvestedThisLap < POWER_UNIT.harvestPerLap && physics.ersEnergy < POWER_UNIT.esCapacity;
    if(!throttle && !physics.reverse && absU > 30 && physics.brakePressure < .05 && canHarvest){
        // 저속에서 P/v 가 과도해지지 않도록 제한 (뒤축 하중 감소로 인한 리프트오프 스핀 완화)
        liftForce = Math.min(POWER_UNIT.liftHarvestKW * 1000 / absU, 1800) * Math.min(1, (absU - 30) / 15);
    }
    const resist = (absU > .02 ? drag + rolling + surfaceDrag + liftForce : 0);

    const cosd = Math.cos(delta), sind = Math.sin(delta);
    const Fx = FxR + FxF * cosd - FyF * sind - dir * resist;
    const Fy = FyR + FyF * cosd + FxF * sind;
    let Mz = a * (FyF * cosd + FxF * sind) - b * FyR;

    /* 스핀 방지 (ESP): 목표 yaw rate 를 넘으면 반대 모멘트 */
    if(assists.stability && absU > 8){
        const muG = (FmaxF + FmaxR) / m;
        const rTarget = Math.min(Math.abs(u * Math.tan(delta) / L), muG / absU) * Math.sign(delta || r);
        const excess = Math.abs(r) - Math.abs(rTarget) * 1.12 - .05;
        if(excess > 0){
            Mz -= Math.sign(r) * excess * Iz * 9;
            physics.escActive = true;
        }
    }

    const ax = Fx / m;
    const ay = Fy / m;
    let du = ax + v * r;
    let dv = ay - u * r;
    let dr = Mz / Iz;

    const prevU = u;
    u += du * h;
    v += dv * h;
    r += dr * h;

    // 제동/저항으로 방향이 뒤집히지 않도록
    if(prevU !== 0 && Math.sign(u) !== Math.sign(prevU) && !(driveDemand !== 0 && Math.sign(driveDemand) === Math.sign(u))){
        u = 0;
    }
    if(Math.abs(u) < .02 && driveDemand === 0) u = 0;

    /* 저속 블렌드: 운동학 자전거 모델 (정지/후진 안정) */
    const w = u < 0 ? 0 : Math.min(1, Math.max(0, (Math.abs(u) - 2) / 4));
    if(w < 1){
        const rKin = u * Math.tan(delta) / L * (physics.surfaceMu < .6 ? .85 : 1);
        const vKin = rKin * b;
        r = w * r + (1 - w) * rKin;
        v = w * v + (1 - w) * vKin;
    }

    // 후진 속도 제한
    if(physics.reverse) u = Math.max(-physics.reverseMaxSpeed, Math.min(0, u));

    physics.u = u;
    physics.v = v;
    physics.r = r;
    physics.yaw += r * h;
    physics.ax += (ax - physics.ax) * Math.min(1, h * 12);
    physics.ay += (ay - physics.ay) * Math.min(1, h * 12);

    tmpForces.Fyf = FyF; tmpForces.Fyr = FyR; tmpForces.Fxf = FxF; tmpForces.Fxr = FxR;
    tmpForces.alphaF = alphaF; tmpForces.alphaR = alphaR;
    tmpForces.Fzf = Fzf; tmpForces.Fzr = Fzr;
    physics.slipAngleFront = alphaF;
    physics.slipAngleRear = alphaR;

    /* ERS: 실제 사용한 구동력 비율만큼 방출, 후륜 제동력에서 회수 */
    stepEnergy.deploy = 0;
    stepEnergy.harvest = 0;
    // 연료: ICE 가 실제로 노면에 전달한 일 + 클러치 슬립/보조 손실
    stepEnergy.fuelJ = usedDrive > 0 ? (usedDrive * physics.iceShare * Math.max(absU, 4) / V.drivetrainEfficiency + 12000) * h : 0;
    if(physics.ersDeployKW > 0 && driveDemand > 0){
        const share = Math.min(1, Math.max(0, usedDrive / driveDemand));
        stepEnergy.deploy = physics.ersDeployKW * 1000 * share * h;
    }
    if(!physics.reverse && absU > 3){
        const regenForce = Math.min(Fbr, POWER_UNIT.mgukMaxKW * 1000 / absU);
        stepEnergy.harvest = (regenForce + liftForce) * absU * h;
    }
    return stepEnergy;
}

/* =========================================================
   GROUND EFFECT / SUSPENSION (포퍼싱)
========================================================= */
function groundEffectFactor(ride){
    const h0 = RIDE_HEIGHT_STATIC;
    if(ride >= FLOOR_STALL_HEIGHT){
        return 1 + GROUND_EFFECT_GAIN * (1 - Math.min(ride, h0 * 1.5) / h0);
    }
    // 플로어 실속: 다운포스 급감
    const peak = 1 + GROUND_EFFECT_GAIN * (1 - FLOOR_STALL_HEIGHT / h0);
    return peak * (.72 + .28 * Math.max(0, ride) / FLOOR_STALL_HEIGHT);
}

let porpoiseTrack = 0;
function updateSuspension(dt){
    const m = physics.mass;
    const k = HEAVE_STIFFNESS;
    const c = HEAVE_DAMPING_RATIO * 2 * Math.sqrt(k * m);
    // 노면 요철 + 연석 충격
    const s = physics.progress * SAMPLE_SPACING;
    const speedF = Math.min(1, Math.abs(physics.u) / 60);
    let bump = Math.sin(s * .9) * Math.sin(s * .23) * 900 * speedF;
    if(physics.onKerb) bump += Math.sin(s * 6.3) * 5200 * Math.min(1, Math.abs(physics.u) / 25);
    if(physics.surface === "gravel" || physics.surface === "grass") bump += Math.sin(s * 3.1) * 2600 * speedF;

    const sub = 4, hh = dt / sub;
    for(let i = 0; i < sub; i++){
        const ride = RIDE_HEIGHT_STATIC - physics.heave;
        const qd = .5 * 1.2 * physics.u * physics.u;
        const ClA = AERO_MODES.Z.ClA + (AERO_MODES.X.ClA - AERO_MODES.Z.ClA) * physics.aeroBlend;
        const df = qd * ClA * groundEffectFactor(ride) * (1 - .16 * physics.dirtyAir);
        const acc = (df + bump - k * physics.heave - c * physics.heaveVel) / m;
        physics.heaveVel += acc * hh;
        physics.heave += physics.heaveVel * hh;
        // 바닥(스키드 블록) 접촉
        if(physics.heave > RIDE_HEIGHT_STATIC - .002){
            physics.heave = RIDE_HEIGHT_STATIC - .002;
            if(physics.heaveVel > 0) physics.heaveVel *= -.3;
        }
    }
    physics.rideHeight = RIDE_HEIGHT_STATIC - physics.heave;
    porpoiseTrack += (Math.abs(physics.heaveVel) - porpoiseTrack) * Math.min(1, dt * 2);
    physics.porpoise = porpoiseTrack;

    // 피치/롤 (시각): 제동 시 노즈 다운, 코너 바깥으로 롤
    const pitchTarget = THREE.MathUtils.degToRad(.32) * (physics.ax / G);
    const rollTarget = -THREE.MathUtils.degToRad(.28) * (physics.ay / G);
    physics.pitch += (pitchTarget - physics.pitch) * Math.min(1, dt * 10);
    physics.roll += (rollTarget - physics.roll) * Math.min(1, dt * 10);
}

/* =========================================================
   TYRES — 온도 / 마모 / 플랫 스팟
========================================================= */
function updateTyres(dt){
    const f = tmpForces;
    const absU = Math.abs(physics.u);
    const compound = TYRE_COMPOUNDS[physics.compound];

    // 축별 슬립 일률 (횡슬립 + 종슬립)
    let pf = Math.abs(f.Fyf) * Math.abs(Math.sin(f.alphaF)) * absU + Math.abs(f.Fxf) * absU * .015;
    let pr = Math.abs(f.Fyr) * Math.abs(Math.sin(f.alphaR)) * absU + Math.abs(f.Fxr) * absU * .02;
    if(physics.lockFront) pf += Math.abs(f.Fxf) * absU * .5;
    if(physics.lockRear) pr += Math.abs(f.Fxr) * absU * .5;
    if(physics.wheelspin) pr += Math.abs(f.Fxr) * Math.max(8, absU) * .5;
    if(physics.surface === "grass" || physics.surface === "gravel"){ pf *= .4; pr *= .4; }

    // 좌우 하중 배분 (횡하중 이동)
    const latShare = Math.max(-.42, Math.min(.42, physics.ay * VEHICLE.cgHeight / (VEHICLE.trackWidth * G) * .9));
    // 좌회전(ay>0)이면 오른쪽(바깥) 타이어 하중 증가
    const shareL = .5 - latShare, shareR = .5 + latShare;
    const shares = [shareL, shareR, shareL, shareR];
    const power = [pf, pf, pr, pr];

    const cooling = 4 + .09 * absU;   // W/K
    for(let i = 0; i < 4; i++){
        const heat = power[i] * shares[i] * TYRE_HEAT_SHARE;
        const T = physics.tyreTemp[i];
        physics.tyreTemp[i] = T + (heat - cooling * (T - TYRE_AMBIENT)) / TYRE_HEAT_CAPACITY * dt;
        // 과열 시 마모 가속
        const over = Math.max(0, T - compound.optimum - 12) / 20;
        physics.tyreWear[i] = Math.min(1, physics.tyreWear[i] + power[i] * shares[i] * TYRE_WEAR_PER_J * compound.wear * (1 + over) * dt);
    }
    if(physics.lockFront && absU > 10) physics.flatSpot[0] = Math.min(1, physics.flatSpot[0] + dt * .6);
    if(physics.lockRear && absU > 10) physics.flatSpot[1] = Math.min(1, physics.flatSpot[1] + dt * .6);
}

/* =========================================================
   WALL COLLISION
========================================================= */
const CAR_HALF_WIDTH = CAR_SPEC.width / 2;

function resolveWallCollision(){
    const limit = WALL_OFFSET - CAR_HALF_WIDTH - .15;
    const lat = physics.lateral;
    if(Math.abs(lat) <= limit) return;
    const sideIdx = lat >= 0 ? 0 : 1;
    if(!wallMask[sideIdx][physics.trackIndex]) return;
    if(Math.abs(lat) > WALL_OFFSET + 3) return;

    const p = trackSamples[physics.trackIndex];
    const sign = Math.sign(lat);
    const push = Math.abs(lat) - limit;
    car.position.x -= p.rx * sign * push;
    car.position.z -= p.rz * sign * push;

    // 월드 속도 → 벽 법선 성분 반사 + 마찰
    const fx = -Math.sin(physics.yaw), fz = -Math.cos(physics.yaw);
    const lx = -Math.cos(physics.yaw), lz = Math.sin(physics.yaw);
    let vx = fx * physics.u + lx * physics.v;
    let vz = fz * physics.u + lz * physics.v;
    const nx = p.rx * sign, nz = p.rz * sign;
    const vn = vx * nx + vz * nz;
    if(vn > 0){
        const speed = Math.hypot(vx, vz) || 1;
        const impact = vn / speed;
        vx -= 1.25 * vn * nx;
        vz -= 1.25 * vn * nz;
        const scrub = 1 - Math.min(.6, .12 + impact * .9);
        vx *= scrub;
        vz *= scrub;
        physics.wallHit = Math.min(1, physics.wallHit + .4 + impact);
    }
    physics.u = vx * fx + vz * fz;
    physics.v = vx * lx + vz * lz;
    physics.r *= .5;

    const trackYaw = Math.atan2(-p.tx, -p.tz);
    let diff = trackYaw - physics.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if(Math.abs(diff) < Math.PI / 2) physics.yaw += diff * .25;
    physics.lateral = sign * limit;
}

/** 다른 차와 접촉했을 때 ai.js 가 호출: 월드 속도 변화량 적용 */
function applyPlayerImpulse(dvx, dvz){
    const fx = -Math.sin(physics.yaw), fz = -Math.cos(physics.yaw);
    const lx = -Math.cos(physics.yaw), lz = Math.sin(physics.yaw);
    physics.u += dvx * fx + dvz * fz;
    physics.v += dvx * lx + dvz * lz;
}

function playerWorldVelocity(out){
    const fx = -Math.sin(physics.yaw), fz = -Math.cos(physics.yaw);
    const lx = -Math.cos(physics.yaw), lz = Math.sin(physics.yaw);
    out.x = fx * physics.u + lx * physics.v;
    out.z = fz * physics.u + lz * physics.v;
    return out;
}

/* =========================================================
   RACE HOOKS
========================================================= */
function physicsOnNewLap(){
    physics.harvestedThisLap = 0;
}

function applyRaceSettingsToCar(){
    physics.compound = TYRE_COMPOUNDS[raceSettings.compound] ? raceSettings.compound : "medium";
    physics.fuelStart = raceSettings.laps * VEHICLE.fuelPerLapEstimate + 2.0;
    physics.fuel = physics.fuelStart;
    physics.mass = VEHICLE.dryMass + physics.fuel;
    physics.tyreTemp = [TYRE_BLANKET, TYRE_BLANKET, TYRE_BLANKET, TYRE_BLANKET];
    physics.tyreWear = [0, 0, 0, 0];
    physics.flatSpot = [0, 0];
    physics.ersEnergy = 3.4e6;
    physics.harvestedThisLap = 0;
    physics.overrideArmed = false;
    physics.overrideActive = false;
    physics.overrideEnergy = 0;
    physics.aeroBlend = 0;
    physics.aeroManualX = false;
    if(typeof setTyreCompoundVisual === "function") setTyreCompoundVisual(physics.compound);
}

function resetDynamics(){
    physics.u = physics.v = physics.r = 0;
    physics.ax = physics.ay = 0;
    physics.speed = 0;
    physics.gear = 0;
    physics.engineRPM = POWER_UNIT.idleRPM;
    physics.steering = 0;
    physics.brakePressure = 0;
    physics.reverse = false;
    physics.wallHit = 0;
    physics.heave = physics.heaveVel = 0;
    physics.pitch = physics.roll = 0;
    physics.slipstream = physics.dirtyAir = 0;
}

/* =========================================================
   RESET — 그리드 박스 (gridSlot 0 = 폴 포지션)
========================================================= */
function gridSlotPosition(slot){
    const i = SAMPLE_COUNT - Math.round((10 + slot * 8) / SAMPLE_SPACING);
    const p = trackSamples[i];
    const lat = (slot % 2 ? 1 : -1) * 3.4;
    return {index: i, x: p.x + p.rx * lat, z: p.z + p.rz * lat, yaw: Math.atan2(-p.tx, -p.tz)};
}

let playerGridSlot = 0;

function resetCar(){
    const g = gridSlotPosition(playerGridSlot);
    car.position.set(g.x, 0, g.z);
    physics.yaw = g.yaw;
    car.rotation.y = physics.yaw;
    resetDynamics();
    physics.trackIndex = g.index;
    physics.progress = g.index - SAMPLE_COUNT;
    lastDetectionZone = -1;
}

/** R 키: 가장 가까운 트랙 중앙으로 복귀 (레이스는 계속) */
function recoverCarToTrack(){
    const q = queryTrack(car.position.x, car.position.z, physics.trackIndex);
    const p = trackSamples[q.index];
    car.position.set(p.x, 0, p.z);
    physics.yaw = Math.atan2(-p.tx, -p.tz);
    car.rotation.y = physics.yaw;
    const progress = physics.progress;
    resetDynamics();
    physics.trackIndex = q.index;
    physics.progress = progress;
}
