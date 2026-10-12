/* =========================================================
   CAR — 2026 F1 규정 기반 실측 비율 모델

   반영한 2026 기술 규정 (검색 결과)
   - 휠베이스 최대 3,400 mm  (2025: 3,600 mm)
   - 전폭 1,900 mm          (2025: 2,000 mm)
   - 최저 중량 768 kg
   - 18인치 휠, 프론트 타이어 폭 -25 mm / 리어 -30 mm
   - 프론트 윙 100 mm 축소, 빔 윙 삭제, 부분 평면 플로어
   - 액티브 에어로: 프론트/리어 윙 플랩이 움직이는 구조 (X/Z 모드)
   - 헤일로(Halo) 장착

   좌표: 원점 = 휠베이스 중앙 지면, -Z = 전방, 단위 m
========================================================= */
"use strict";

const CAR_SPEC = {
    wheelBase: 3.4,
    width: 1.9,
    tireRadius: .36,
    frontTireWidth: .28,
    rearTireWidth: .375,
    frontAxleZ: -1.7,
    rearAxleZ: 1.7
};

const car = new THREE.Group();
scene.add(car);

/* ---------------------------------------------------------
   MATERIALS
--------------------------------------------------------- */
const LIVERY_RED = 0xc8101e;

const paintMaterial = QUALITY.physicalPaint
    ? new THREE.MeshPhysicalMaterial({color: LIVERY_RED, metalness: .45, roughness: .32, clearcoat: 1, clearcoatRoughness: .07})
    : new THREE.MeshStandardMaterial({color: LIVERY_RED, metalness: .4, roughness: .3});
const whitePaint = new THREE.MeshStandardMaterial({color: 0xf1f1f1, metalness: .1, roughness: .35});
const carbonMaterial = new THREE.MeshStandardMaterial({color: 0x17191c, metalness: .35, roughness: .42});
const matteBlack = new THREE.MeshStandardMaterial({color: 0x090909, metalness: .1, roughness: .8});
const tireMaterial = new THREE.MeshStandardMaterial({color: 0x151515, metalness: 0, roughness: .92});
const metalMaterial = new THREE.MeshStandardMaterial({color: 0x8d9196, metalness: .85, roughness: .3});
const helmetMaterial = new THREE.MeshStandardMaterial({color: 0xf5c400, metalness: .2, roughness: .25});
const visorMaterial = new THREE.MeshStandardMaterial({color: 0x111418, metalness: .9, roughness: .1});
const rainLightMaterial = new THREE.MeshBasicMaterial({color: 0x550000});

const bodyParts = new THREE.Group();
car.add(bodyParts);

function addPart(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = bodyParts){
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
}

function cylinderBetween(a, b, radius, material, parent = bodyParts, segments = 6){
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, segments);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(a).addScaledVector(dir, .5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    parent.add(mesh);
    return mesh;
}

const radial = QUALITY_NAME === "low" ? 14 : 20;

/* ---------------------------------------------------------
   MONOCOQUE + NOSE
--------------------------------------------------------- */
addPart(loftGeometry([
    {z: -2.86, w: .07, h: .05, y: .24, n: 2.2},
    {z: -2.55, w: .12, h: .08, y: .29, n: 2.3},
    {z: -2.1,  w: .17, h: .12, y: .36, n: 2.4},
    {z: -1.6,  w: .22, h: .16, y: .43, n: 2.6},
    {z: -1.1,  w: .27, h: .19, hb: .23, y: .50, n: 2.8},
    {z: -.7,   w: .32, h: .2,  hb: .3,  y: .53, n: 3.0},
    {z: -.2,   w: .37, h: .18, hb: .34, y: .55, n: 3.2},
    {z: .3,    w: .39, h: .2,  hb: .34, y: .55, n: 3.2},
    {z: .8,    w: .31, h: .2,  hb: .3,  y: .51, n: 3.0},
    {z: 1.4,   w: .2,  h: .15, hb: .2,  y: .45, n: 2.8},
    {z: 1.95,  w: .1,  h: .09, hb: .1,  y: .42, n: 2.4}
], radial), paintMaterial);

// 콕핏 개구부
addPart(loftGeometry([
    {z: -.62, w: .2,  h: .02, y: .735},
    {z: -.4,  w: .26, h: .025, y: .74},
    {z: .1,   w: .25, h: .025, y: .745},
    {z: .2,   w: .18, h: .02, y: .745}
], 14), matteBlack);

/* ---------------------------------------------------------
   ENGINE COVER / AIRBOX / SHARK FIN
--------------------------------------------------------- */
addPart(loftGeometry([
    {z: .08,  w: .14, h: .12, y: .86, n: 2.6},
    {z: .35,  w: .19, h: .14, y: .83, n: 2.8},
    {z: .9,   w: .2,  h: .12, y: .74, n: 2.8},
    {z: 1.5,  w: .13, h: .09, y: .62, n: 2.6},
    {z: 2.02, w: .06, h: .05, y: .52, n: 2.4}
], radial), paintMaterial);

// 에어박스 흡입구
addPart(new THREE.CircleGeometry(.1, 14), matteBlack, 0, .87, .075, 0, Math.PI, 0).scale.set(1, .85, 1);
// T-캠 (노란색 = 1번 드라이버)
addPart(new THREE.BoxGeometry(.2, .035, .06), helmetMaterial, 0, 1.0, .12);

{
    const fin = new THREE.Shape();
    fin.moveTo(.3, .93);
    fin.lineTo(1.75, .86);
    fin.lineTo(1.75, .62);
    fin.lineTo(.95, .72);
    fin.closePath();
    const geo = new THREE.ExtrudeGeometry(fin, {depth: .014, bevelEnabled: false});
    geo.translate(0, 0, -.007);
    // shape 의 x → 차량 z, y → y,  압출 z → 차량 x
    geo.rotateY(-Math.PI / 2);
    addPart(geo, whitePaint);
}

/* ---------------------------------------------------------
   SIDEPODS
--------------------------------------------------------- */
for(const s of [-1, 1]){
    addPart(loftGeometry([
        {z: -.78, x: s * .47, w: .13, h: .15, y: .45, n: 3.2},
        {z: -.55, x: s * .54, w: .19, h: .19, y: .45, n: 3.2},
        {z: .2,   x: s * .55, w: .21, h: .17, y: .42, n: 3.0},
        {z: .85,  x: s * .47, w: .16, h: .12, y: .35, n: 2.8},
        {z: 1.35, x: s * .36, w: .09, h: .07, y: .29, n: 2.6}
    ], radial), paintMaterial);
    // 냉각 흡입구
    const inlet = addPart(new THREE.CircleGeometry(.13, 12), matteBlack, s * .47, .45, -.785, 0, Math.PI, 0);
    inlet.scale.set(1, 1.1, 1);
    // 흰색 스트라이프
    addPart(loftGeometry([
        {z: -.4, x: s * .735, w: .012, h: .05, y: .5},
        {z: .5,  x: s * .7,   w: .012, h: .04, y: .46}
    ], 8), whitePaint);
    // 미러
    cylinderBetween(new THREE.Vector3(s * .36, .72, -.62), new THREE.Vector3(s * .5, .78, -.66), .012, carbonMaterial);
    addPart(new THREE.BoxGeometry(.16, .07, .05), carbonMaterial, s * .55, .79, -.67);
}

/* ---------------------------------------------------------
   FLOOR / DIFFUSER
--------------------------------------------------------- */
{
    const floor = new THREE.Shape();
    // (x, z) 평면도
    floor.moveTo(-.3, -1.35);
    floor.lineTo(.3, -1.35);
    floor.lineTo(.62, -.9);
    floor.lineTo(.72, .2);
    floor.lineTo(.7, 1.35);
    floor.lineTo(.5, 1.45);
    floor.lineTo(-.5, 1.45);
    floor.lineTo(-.7, 1.35);
    floor.lineTo(-.72, .2);
    floor.lineTo(-.62, -.9);
    floor.closePath();
    const geo = new THREE.ExtrudeGeometry(floor, {depth: .025, bevelEnabled: false});
    geo.rotateX(Math.PI / 2);   // shape y → -z?  (rotateX +90°: y → z)
    addPart(geo, carbonMaterial, 0, .07, 0);

    // 디퓨저 (위로 꺾인 판 + 펜스)
    const diff = addPart(new THREE.BoxGeometry(.98, .02, .5), carbonMaterial, 0, .17, 1.68, -.42, 0, 0);
    diff.castShadow = true;
    for(const x of [-.49, -.18, .18, .49]){
        addPart(new THREE.BoxGeometry(.015, .2, .5), carbonMaterial, x, .15, 1.68, -.42, 0, 0);
    }
}

/* ---------------------------------------------------------
   FRONT WING (2026: 100 mm 축소, 액티브 플랩)
--------------------------------------------------------- */
const frontFlaps = new THREE.Group();
{
    const span = 1.62;
    addPart(airfoilGeometry(span, .3, .035, -.4), carbonMaterial, 0, .1, -2.78, -.06, 0, 0);
    // 노즈와 윙을 잇는 필러
    for(const x of [-.09, .09]) addPart(new THREE.BoxGeometry(.02, .14, .2), carbonMaterial, x, .18, -2.76);

    frontFlaps.position.set(0, .15, -2.62);
    bodyParts.add(frontFlaps);
    addPart(airfoilGeometry(span - .1, .18, .028, -.4), paintMaterial, 0, 0, 0, -.25, 0, 0, frontFlaps);
    addPart(airfoilGeometry(span - .2, .14, .024, -.4), carbonMaterial, 0, .06, .1, -.45, 0, 0, frontFlaps);

    for(const s of [-1, 1]){
        addPart(new THREE.BoxGeometry(.02, .26, .55), paintMaterial, s * (span / 2 + .01), .18, -2.68);
        addPart(new THREE.BoxGeometry(.06, .02, .5), carbonMaterial, s * (span / 2 - .02), .06, -2.68);
    }
}

/* ---------------------------------------------------------
   REAR WING (빔 윙 삭제, 액티브 플랩)
--------------------------------------------------------- */
const rearFlap = new THREE.Group();
{
    const span = 1.0;
    addPart(airfoilGeometry(span, .32, .04, -.5), carbonMaterial, 0, .82, 1.92, -.12, 0, 0);
    rearFlap.position.set(0, .95, 2.0);
    bodyParts.add(rearFlap);
    addPart(airfoilGeometry(span - .02, .2, .03, -.4), paintMaterial, 0, 0, 0, -.45, 0, 0, rearFlap);

    for(const s of [-1, 1]){
        const ep = new THREE.Shape();
        ep.moveTo(-.33, .55); ep.lineTo(.3, .6); ep.lineTo(.32, 1.06); ep.lineTo(-.2, 1.04); ep.closePath();
        const geo = new THREE.ExtrudeGeometry(ep, {depth: .02, bevelEnabled: false});
        geo.rotateY(-Math.PI / 2);
        addPart(geo, paintMaterial, s * (span / 2 + .01) + .01, 0, 1.95);
    }
    // 스완넥 파일런
    addPart(new THREE.BoxGeometry(.025, .38, .1), carbonMaterial, 0, .63, 1.92, .25, 0, 0);
    // 레인 라이트
    addPart(new THREE.BoxGeometry(.13, .05, .03), rainLightMaterial, 0, .47, 2.05);
}

/* ---------------------------------------------------------
   HALO
--------------------------------------------------------- */
{
    const ring = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.3, .62, .2),
        new THREE.Vector3(-.33, .84, .05),
        new THREE.Vector3(-.3, .9, -.3),
        new THREE.Vector3(-.15, .92, -.56),
        new THREE.Vector3(0, .925, -.63),
        new THREE.Vector3(.15, .92, -.56),
        new THREE.Vector3(.3, .9, -.3),
        new THREE.Vector3(.33, .84, .05),
        new THREE.Vector3(.3, .62, .2)
    ]);
    addPart(new THREE.TubeGeometry(ring, 40, .022, 8, false), carbonMaterial);
    const pillar = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, .925, -.63),
        new THREE.Vector3(0, .82, -.78),
        new THREE.Vector3(0, .7, -.88)
    ]);
    addPart(new THREE.TubeGeometry(pillar, 10, .02, 8, false), carbonMaterial);
}

/* ---------------------------------------------------------
   SUSPENSION
--------------------------------------------------------- */
{
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const fz = CAR_SPEC.frontAxleZ, rz = CAR_SPEC.rearAxleZ;
    for(const s of [-1, 1]){
        // 프론트: 상/하 위시본 + 푸시로드
        cylinderBetween(V(s * .22, .52, fz - .25), V(s * .68, .5, fz), .016, carbonMaterial);
        cylinderBetween(V(s * .22, .5, fz + .3), V(s * .68, .5, fz), .016, carbonMaterial);
        cylinderBetween(V(s * .2, .33, fz - .3), V(s * .7, .24, fz), .016, carbonMaterial);
        cylinderBetween(V(s * .2, .33, fz + .3), V(s * .7, .24, fz), .016, carbonMaterial);
        cylinderBetween(V(s * .25, .62, fz + .1), V(s * .66, .26, fz), .014, carbonMaterial);
        // 리어
        cylinderBetween(V(s * .16, .5, rz - .35), V(s * .62, .52, rz), .016, carbonMaterial);
        cylinderBetween(V(s * .16, .46, rz + .2), V(s * .62, .52, rz), .016, carbonMaterial);
        cylinderBetween(V(s * .16, .26, rz - .35), V(s * .64, .2, rz), .016, carbonMaterial);
        cylinderBetween(V(s * .16, .26, rz + .2), V(s * .64, .2, rz), .016, carbonMaterial);
    }
}

/* ---------------------------------------------------------
   DRIVER — 헬멧 / 스티어링 휠 / 장갑
--------------------------------------------------------- */
const driverHead = new THREE.Group();
driverHead.position.set(0, .84, -.06);
car.add(driverHead);
addPart(new THREE.SphereGeometry(.135, 18, 12), helmetMaterial, 0, 0, 0, 0, 0, 0, driverHead);
{
    // 전방(-z)을 향한 바이저 띠
    addPart(new THREE.SphereGeometry(.137, 16, 6, Math.PI * 1.15, Math.PI * .7, Math.PI * .38, Math.PI * .2), visorMaterial, 0, 0, 0, 0, 0, 0, driverHead);
}

const steeringWheel = new THREE.Group();
steeringWheel.position.set(0, .72, -.43);
steeringWheel.rotation.x = -.35;
car.add(steeringWheel);
{
    addPart(new THREE.BoxGeometry(.27, .11, .03), carbonMaterial, 0, 0, 0, 0, 0, 0, steeringWheel);
    for(const s of [-1, 1]){
        addPart(new THREE.CylinderGeometry(.03, .03, .13, 8), matteBlack, s * .15, -.005, 0, 0, 0, s * .2, steeringWheel);
        // 장갑
        addPart(new THREE.SphereGeometry(.042, 8, 6), suitGloveMaterial(), s * .155, .015, -.01, 0, 0, 0, steeringWheel);
    }
    const screen = makeCanvasTexture(64, 32, (ctx, w, h) => {
        ctx.fillStyle = "#050607"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#19d36b"; ctx.fillRect(4, 4, 56, 4);
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; ctx.fillText("F1", w / 2, 25);
    }, {wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
    addPart(new THREE.PlaneGeometry(.11, .055), new THREE.MeshBasicMaterial({map: screen}), 0, .005, .0165, 0, 0, 0, steeringWheel);
}

function suitGloveMaterial(){
    if(!suitGloveMaterial.cached) suitGloveMaterial.cached = new THREE.MeshStandardMaterial({color: 0x1b1d22, roughness: .8});
    return suitGloveMaterial.cached;
}

/* ---------------------------------------------------------
   WHEELS — 둥근 숄더 타이어 + 회전이 보이는 사이드월 텍스처
--------------------------------------------------------- */
const sidewallTexture = makeCanvasTexture(256, 256, (ctx, w, h) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#141414";
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    // 컴파운드 컬러 링 (미디엄 = 노랑) — 두 군데 끊어 회전이 보이게
    ctx.strokeStyle = "#f2c200";
    ctx.lineWidth = 7;
    for(const start of [0, Math.PI]){
        ctx.beginPath(); ctx.arc(c, c, c * .84, start + .25, start + Math.PI - .25); ctx.stroke();
    }
    ctx.fillStyle = "#e8e8e8";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    for(const a of [Math.PI / 2, -Math.PI / 2]){
        ctx.save(); ctx.translate(c, c); ctx.rotate(a); ctx.fillText("RACING", 0, -c * .7); ctx.restore();
    }
    // 림
    ctx.fillStyle = "#2a2c30";
    ctx.beginPath(); ctx.arc(c, c, c * .62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#5a5e64";
    ctx.lineWidth = 9;
    for(let i = 0; i < 10; i++){
        const a = i / 10 * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * c * .16, c + Math.sin(a) * c * .16);
        ctx.lineTo(c + Math.cos(a + .18) * c * .58, c + Math.sin(a + .18) * c * .58);
        ctx.stroke();
    }
    ctx.fillStyle = "#c8102e";
    ctx.beginPath(); ctx.arc(c, c, c * .13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(c, c, c * .06, 0, Math.PI * 2); ctx.fill();
}, {wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
const sidewallMaterial = new THREE.MeshStandardMaterial({map: sidewallTexture, roughness: .7, metalness: .1, transparent: false, alphaTest: .5});

const wheels = [];

function createWheel(side, x, z, radius, width, isFront){
    const steer = new THREE.Group();
    steer.position.set(x, radius, z);
    car.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);

    const hw = width / 2;
    const profile = [
        new THREE.Vector2(radius * .64, -hw),
        new THREE.Vector2(radius * .93, -hw),
        new THREE.Vector2(radius * .985, -hw + .025),
        new THREE.Vector2(radius, -hw + .06),
        new THREE.Vector2(radius, hw - .06),
        new THREE.Vector2(radius * .985, hw - .025),
        new THREE.Vector2(radius * .93, hw),
        new THREE.Vector2(radius * .64, hw)
    ];
    const tireGeo = new THREE.LatheGeometry(profile, QUALITY_NAME === "low" ? 20 : 30);
    tireGeo.rotateZ(Math.PI / 2);
    addPart(tireGeo, tireMaterial, 0, 0, 0, 0, 0, 0, spin);

    for(const face of [-1, 1]){
        const disc = addPart(new THREE.CircleGeometry(radius * .995, 28), sidewallMaterial, face * (hw + .001), 0, 0, 0, face * Math.PI / 2, 0, spin);
        disc.renderOrder = 1;
    }
    // 브레이크 덕트 / 업라이트
    addPart(new THREE.CylinderGeometry(radius * .45, radius * .45, width * .6, 10), carbonMaterial, -side * .02, 0, 0, 0, 0, Math.PI / 2, steer);

    wheels.push({steer, spin, radius, isFront});
}

createWheel(-1, -(CAR_SPEC.width / 2 - CAR_SPEC.frontTireWidth / 2) + .01, CAR_SPEC.frontAxleZ, CAR_SPEC.tireRadius, CAR_SPEC.frontTireWidth, true);
createWheel(1, (CAR_SPEC.width / 2 - CAR_SPEC.frontTireWidth / 2) - .01, CAR_SPEC.frontAxleZ, CAR_SPEC.tireRadius, CAR_SPEC.frontTireWidth, true);
createWheel(-1, -(CAR_SPEC.width / 2 - CAR_SPEC.rearTireWidth / 2), CAR_SPEC.rearAxleZ, CAR_SPEC.tireRadius, CAR_SPEC.rearTireWidth, false);
createWheel(1, (CAR_SPEC.width / 2 - CAR_SPEC.rearTireWidth / 2), CAR_SPEC.rearAxleZ, CAR_SPEC.tireRadius, CAR_SPEC.rearTireWidth, false);

/* ---------------------------------------------------------
   BLOB SHADOW (모든 품질에서 사용 — 비용 거의 0)
--------------------------------------------------------- */
{
    const tex = makeCanvasTexture(64, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(0,0,0,.62)");
        g.addColorStop(.7, "rgba(0,0,0,.35)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save(); ctx.scale(1, h / w); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); ctx.restore();
    }, {wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
    const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(2.5, 5.9),
        new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8})
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = .035;
    blob.renderOrder = 2;
    car.add(blob);
}

/* ---------------------------------------------------------
   DRAW CALL 최적화: 정적 차체를 재질별로 병합
--------------------------------------------------------- */
{
    const animated = new Set([frontFlaps, rearFlap]);
    const merged = mergeGroupByMaterial(bodyParts, obj => animated.has(obj));
    car.remove(bodyParts);
    car.add(merged);
    for(const g of animated) merged.add(g);
}

car.traverse(obj => {
    if(obj.isMesh && obj.material !== undefined && !(obj.material.transparent)){
        obj.castShadow = QUALITY.shadows;
    }
});

/** 매 프레임: 바퀴 회전 / 조향 / 스티어링 휠 */
function updateCarVisuals(dt, speed, steering, braking){
    for(const w of wheels){
        w.spin.rotation.x -= (speed / w.radius) * dt;
        if(w.isFront) w.steer.rotation.y = steering;
    }
    steeringWheel.rotation.z = -steering * 2.4;
    rainLightMaterial.color.setHex(braking ? 0xff2020 : 0x550000);
}
