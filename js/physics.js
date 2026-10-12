/* =========================================================
   VEHICLE PHYSICS
   기존 물리 모델(엔진 토크 곡선, 기어, 공기저항, 다운포스, 제동, 노면)을
   그대로 유지하고 입력부만 아날로그(기울기 조향)에 맞게 바꿨다.
   실제 F1 물리 원리를 추가 적용하는 항목은 docs/PHYSICS_PROPOSAL.md 의
   승인 결과에 따라 반영한다.

   단위: mass = kg, speed = m/s, force = N, torque = Nm
========================================================= */
"use strict";

const physics = {
    /* vehicle */
    mass: 798,
    wheelRadius: .33,
    wheelBase: 3.2,
    trackWidth: 1.55,

    /* engine */
    engineMaxRPM: 15000,
    idleRPM: 5000,
    engineRPM: 5000,
    engineTorque: 0,

    /* transmission */
    gears: [3.20, 2.65, 2.15, 1.78, 1.50, 1.28, 1.08, .92],
    finalDrive: 3.10,
    gear: 0,
    shiftUpRPM: 13800,
    shiftDownRPM: 8500,
    shiftTimer: 0,
    shiftDelay: .12,

    /* speed */
    speed: 0,
    maxSpeed: 95,

    /* steering */
    steering: 0,
    steeringTarget: 0,
    yaw: 0,

    /* braking */
    brakeForce: 16000,

    /* aerodynamic */
    rho: 1.225,
    Cd: .72,
    frontalArea: 1.5,
    downforceCoefficient: 4.0,

    /* rolling resistance */
    rollingCoefficient: .012,

    /* surface */
    surface: "asphalt",
    grip: 1,
    rolling: 1,
    surfaceDriveMultiplier: 1,
    surfaceBrakeMultiplier: 1,
    surfaceExtraDrag: 0,
    surfaceMaxSpeed: 95,
    reverseRatio: 2.80,
    reverseMaxSpeed: 8.0,
    reverse: false,
    smoothSurfaceLimit: 95,
    brakePressure: 0,

    /* track tracking */
    trackIndex: 0,
    lateral: 0,
    onKerb: false,
    wallHit: 0,

    /* telemetry */
    driveForce: 0,
    dragForce: 0,
    rollingForce: 0,
    brakeForceActual: 0,
    acceleration: 0
};


/* =========================================================
   ENGINE TORQUE CURVE
========================================================= */
const TORQUE_CURVE = [
    [5000, 430], [6500, 500], [8000, 560], [9500, 575],
    [11000, 565], [12500, 535], [13800, 490], [15000, 420]
];

function getEngineTorque(rpm){
    const points = TORQUE_CURVE;
    if(rpm <= points[0][0]) return points[0][1];
    if(rpm >= points[points.length - 1][0]) return points[points.length - 1][1];
    for(let i = 0; i < points.length - 1; i++){
        const a = points[i], b = points[i + 1];
        if(rpm >= a[0] && rpm <= b[0]){
            return THREE.MathUtils.lerp(a[1], b[1], (rpm - a[0]) / (b[0] - a[0]));
        }
    }
    return 500;
}


/* =========================================================
   SURFACE
   도로 + 연석 = 아스팔트 / 그 밖 = 잔디
========================================================= */
function updateSurface(){
    const q = queryTrack(car.position.x, car.position.z, physics.trackIndex);
    physics.trackIndex = q.index;
    physics.lateral = q.lateral;

    const half = ROAD_WIDTH / 2;
    const sideIdx = q.lateral >= 0 ? 0 : 1;
    const onKerb = q.dist > half && q.dist <= half + KERB_WIDTH && kerbMask[sideIdx][q.index] === 1;
    physics.onKerb = onKerb;

    const surface = (q.dist <= half || onKerb) ? "asphalt" : "grass";
    physics.surface = surface;

    if(surface === "asphalt"){
        physics.grip = 1.00;
        physics.rolling = 1.00;
        physics.surfaceDriveMultiplier = 1.00;
        physics.surfaceBrakeMultiplier = 1.00;
        physics.surfaceExtraDrag = 0;
        physics.surfaceMaxSpeed = physics.maxSpeed;
    }else{
        // 잔디: 약 202 km/h 목표, 추가 저항으로 부드럽게 감속
        physics.grip = .38;
        physics.rolling = 4.5;
        physics.surfaceDriveMultiplier = .68;
        physics.surfaceBrakeMultiplier = .66;
        physics.surfaceExtraDrag = 260;
        physics.surfaceMaxSpeed = 56.1;
    }

    const target = physics.surfaceMaxSpeed;
    const response = physics.surface === "grass" ? 1.15 : 2.5;
    physics.smoothSurfaceLimit += (target - physics.smoothSurfaceLimit) * Math.min(1, response / 60);
}


/* =========================================================
   AERODYNAMICS
   Fd = 1/2 rho Cd A v²,  downforce = k v²
========================================================= */
function calculateAero(){
    const v = Math.abs(physics.speed);
    physics.dragForce = .5 * physics.rho * physics.Cd * physics.frontalArea * v * v;
    return physics.downforceCoefficient * v * v;
}


/* =========================================================
   ENGINE RPM / GEARBOX
========================================================= */
function updateEngineRPM(){
    if(physics.reverse){
        const wheelRPM = (Math.abs(physics.speed) / (2 * Math.PI * physics.wheelRadius)) * 60;
        const targetRPM = wheelRPM * physics.reverseRatio * physics.finalDrive;
        physics.engineRPM = THREE.MathUtils.lerp(physics.engineRPM, Math.max(physics.idleRPM, targetRPM), .18);
        physics.engineRPM = THREE.MathUtils.clamp(physics.engineRPM, physics.idleRPM, physics.engineMaxRPM);
        return;
    }

    if(physics.gear <= 0){
        physics.engineRPM = THREE.MathUtils.lerp(physics.engineRPM, physics.idleRPM, .08);
        return;
    }

    const wheelRPM = (Math.abs(physics.speed) / (2 * Math.PI * physics.wheelRadius)) * 60;
    const targetRPM = wheelRPM * physics.gears[physics.gear] * physics.finalDrive;
    physics.engineRPM = THREE.MathUtils.lerp(physics.engineRPM, Math.max(physics.idleRPM, targetRPM), .25);

    if(physics.engineRPM > physics.shiftUpRPM && physics.gear < physics.gears.length - 1){
        physics.gear++;
        physics.shiftTimer = physics.shiftDelay;
    }
    if(physics.engineRPM < physics.shiftDownRPM && physics.gear > 1){
        physics.gear--;
        physics.shiftTimer = physics.shiftDelay;
    }

    physics.engineRPM = THREE.MathUtils.clamp(physics.engineRPM, physics.idleRPM, physics.engineMaxRPM);
}

function calculateDriveForce(throttle, downforce){
    if(!throttle){
        physics.driveForce = 0;
        return 0;
    }

    const torque = getEngineTorque(physics.engineRPM);
    physics.engineTorque = torque;
    const normalForce = physics.mass * 9.81 + downforce;
    const tractionLimit = physics.grip * normalForce;

    if(physics.reverse){
        const wheelTorque = torque * physics.reverseRatio * physics.finalDrive;
        const engineForce = wheelTorque / physics.wheelRadius;
        const actualForce = Math.min(engineForce, tractionLimit) * physics.surfaceDriveMultiplier;
        physics.driveForce = actualForce;
        return -actualForce;
    }

    if(physics.gear < 1){
        physics.driveForce = 0;
        return 0;
    }

    const wheelTorque = torque * physics.gears[physics.gear] * physics.finalDrive;
    const engineForce = wheelTorque / physics.wheelRadius;
    const actualForce = Math.min(engineForce, tractionLimit) * physics.surfaceDriveMultiplier;
    physics.driveForce = actualForce;
    return actualForce;
}


/* =========================================================
   BRAKING — 페달 압력 램프 + 타이어 한계
========================================================= */
function calculateBrakeForce(brake, downforce, dt){
    const target = brake ? 1 : 0;
    const rate = target > physics.brakePressure ? 8.5 : 11.0;
    physics.brakePressure += (target - physics.brakePressure) * Math.min(1, rate * dt);

    if(physics.brakePressure < .001){
        physics.brakeForceActual = 0;
        return 0;
    }

    const normalForce = physics.mass * 9.81 + downforce;
    const tireLimit = physics.grip * physics.surfaceBrakeMultiplier * normalForce;
    const availableBrake = Math.min(physics.brakeForce, tireLimit);
    const brakeForce = availableBrake * physics.brakePressure;
    physics.brakeForceActual = brakeForce;
    return brakeForce;
}

function calculateRollingResistance(){
    const normalForce = physics.mass * 9.81;
    const magnitude = physics.rollingCoefficient * physics.rolling * normalForce;
    if(Math.abs(physics.speed) < 0.02) return 0;
    return Math.sign(physics.speed) * magnitude;
}


/* =========================================================
   WALL COLLISION
   방호벽이 실제로 존재하는 구간에서만 차량을 벽 안쪽으로 되돌리고
   충돌 각도에 비례해 속도를 줄인다.
========================================================= */
const CAR_HALF_WIDTH = CAR_SPEC.width / 2;

function resolveWallCollision(){
    const limit = WALL_OFFSET - CAR_HALF_WIDTH - .15;
    const lat = physics.lateral;
    if(Math.abs(lat) <= limit) return;
    const sideIdx = lat >= 0 ? 0 : 1;
    if(!wallMask[sideIdx][physics.trackIndex]) return;
    // 이미 벽 너머(클리핑 경계 등)로 깊게 들어간 경우는 무시
    if(Math.abs(lat) > WALL_OFFSET + 3) return;

    const p = trackSamples[physics.trackIndex];
    const sign = Math.sign(lat);
    const push = Math.abs(lat) - limit;
    car.position.x -= p.rx * sign * push;
    car.position.z -= p.rz * sign * push;

    // 진행 방향과 벽 법선 사이 각도 → 충돌 강도
    const fx = -Math.sin(physics.yaw), fz = -Math.cos(physics.yaw);
    const dirSign = physics.speed >= 0 ? 1 : -1;
    const impact = Math.max(0, (fx * p.rx + fz * p.rz) * sign * dirSign);
    physics.speed *= 1 - Math.min(.85, .25 + impact * 1.1);

    // 벽과 나란하도록 차체를 살짝 돌린다
    const trackYaw = Math.atan2(-p.tx, -p.tz);
    let diff = trackYaw - physics.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if(Math.abs(diff) < Math.PI / 2) physics.yaw += diff * .35;
    physics.lateral = sign * limit;
    physics.wallHit = Math.min(1, physics.wallHit + .4 + impact);
}


/* =========================================================
   CAR UPDATE
========================================================= */
function updateCar(dt, controlsLocked){
    const throttle = !controlsLocked && Input.throttle;
    const brakeInput = controlsLocked ? true : Input.brake;

    updateSurface();
    const downforce = calculateAero();

    /* FORWARD / REVERSE STATE
       가속: forward,  브레이크: 감속 → 완전히 멈춘 뒤 후진 */
    if(throttle){
        physics.reverse = false;
        if(physics.speed < -.15){
            physics.gear = 0;
        }else if(physics.gear === 0){
            physics.gear = 1;
            physics.engineRPM = 6000;
        }
    }else if(brakeInput && physics.speed <= .15 && !controlsLocked){
        physics.reverse = true;
        physics.gear = -1;
    }else if(!brakeInput && physics.reverse && Math.abs(physics.speed) < .08){
        physics.reverse = false;
        physics.gear = 0;
    }

    updateEngineRPM();
    if(physics.shiftTimer > 0) physics.shiftTimer -= dt;

    const forwardBraking = brakeInput && physics.speed > .08 && !physics.reverse;
    const reverseBraking = throttle && physics.speed < -.08;

    let driveForce = 0;
    if(physics.shiftTimer <= 0 && !forwardBraking && !reverseBraking && !controlsLocked){
        driveForce = calculateDriveForce(throttle || (physics.reverse && brakeInput), downforce);
    }

    const brakeForce = calculateBrakeForce(forwardBraking || reverseBraking, downforce, dt);
    const rollingForce = calculateRollingResistance();
    const dragForceSigned = Math.sign(physics.speed) * physics.dragForce;

    let surfaceDrag = 0;
    if(physics.surface === "grass"){
        const v = Math.abs(physics.speed);
        const softLimit = 54.7;
        const excess = Math.max(0, v - softLimit);
        surfaceDrag = (physics.surfaceExtraDrag + excess * 900) * Math.sign(physics.speed);
    }

    const netForce = driveForce - dragForceSigned - rollingForce - surfaceDrag - Math.sign(physics.speed || 1) * brakeForce;

    physics.acceleration = netForce / physics.mass;
    physics.speed += physics.acceleration * dt;

    if(physics.reverse){
        physics.speed = Math.max(-physics.reverseMaxSpeed, Math.min(0, physics.speed));
    }else{
        const limit = Math.max(physics.smoothSurfaceLimit, physics.surface === "grass" ? 54.5 : physics.maxSpeed);
        physics.speed = Math.min(physics.speed, limit);
        if(physics.speed < 0 && !reverseBraking) physics.speed = Math.min(physics.speed + Math.abs(physics.acceleration) * dt, 0);
    }

    /* STEERING
       저속: 큰 조향,  고속: 같은 입력에 더 작은 방향 변화 */
    const absSpeed = Math.abs(physics.speed);
    const speedRatio = Math.min(1, absSpeed / 85);
    const sensitivity = Math.pow(speedRatio, 1.65);

    let maxSteering = THREE.MathUtils.lerp(.78, .045, sensitivity);
    let steeringResponse = THREE.MathUtils.lerp(8.5, 2.8, speedRatio);
    if(physics.surface === "grass"){
        maxSteering *= .84;
        steeringResponse *= .90;
    }

    // Input.steer: -1(우) ~ +1(좌). 키보드는 ±1, 기울기는 아날로그 값
    physics.steeringTarget = Input.steer * maxSteering;
    physics.steering += (physics.steeringTarget - physics.steering) * Math.min(1, steeringResponse * dt);

    if(absSpeed > .05){
        let yawRate = (absSpeed / physics.wheelBase) * Math.tan(physics.steering);
        yawRate *= physics.grip;
        const highSpeedFactor = THREE.MathUtils.lerp(1, .30, Math.pow(speedRatio, 1.7));
        yawRate *= highSpeedFactor;
        if(physics.surface === "grass") yawRate *= .84;
        const maxYawRate = THREE.MathUtils.lerp(1.90, .22, Math.pow(speedRatio, 1.6));
        yawRate = THREE.MathUtils.clamp(yawRate, -maxYawRate, maxYawRate);
        if(physics.reverse) yawRate = -yawRate;
        physics.yaw += yawRate * dt;
    }
    car.rotation.y = physics.yaw;

    // 이동 (local -Z = forward)
    if(Math.abs(physics.speed) > .001){
        car.position.x += -Math.sin(physics.yaw) * physics.speed * dt;
        car.position.z += -Math.cos(physics.yaw) * physics.speed * dt;
    }

    resolveWallCollision();
    physics.wallHit = Math.max(0, physics.wallHit - dt * 2.5);
}


/* =========================================================
   RESET — 폴 포지션 그리드 박스
========================================================= */
function resetCar(){
    const i = SAMPLE_COUNT - Math.round(10 / SAMPLE_SPACING);
    const p = trackSamples[i];
    car.position.set(p.x - p.rx * 3.4, 0, p.z - p.rz * 3.4);
    physics.yaw = Math.atan2(-p.tx, -p.tz);
    car.rotation.y = physics.yaw;

    physics.speed = 0;
    physics.gear = 0;
    physics.engineRPM = physics.idleRPM;
    physics.steering = 0;
    physics.steeringTarget = 0;
    physics.brakePressure = 0;
    physics.reverse = false;
    physics.smoothSurfaceLimit = physics.maxSpeed;
    physics.surfaceMaxSpeed = physics.maxSpeed;
    physics.trackIndex = i;
    physics.wallHit = 0;
}

/** R 키: 현재 위치에서 가장 가까운 트랙 중앙으로 복귀 (레이스는 계속) */
function recoverCarToTrack(){
    const q = queryTrack(car.position.x, car.position.z, physics.trackIndex);
    const p = trackSamples[q.index];
    car.position.set(p.x, 0, p.z);
    physics.yaw = Math.atan2(-p.tx, -p.tz);
    car.rotation.y = physics.yaw;
    physics.speed = 0;
    physics.gear = 0;
    physics.steering = 0;
    physics.reverse = false;
    physics.brakePressure = 0;
    physics.trackIndex = q.index;
}
