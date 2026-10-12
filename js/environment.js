/* =========================================================
   ENVIRONMENT
   - 하늘 셰이더 + 환경맵(차체 반사)
   - 도로 / 연석 / 방호벽 / 캐치펜스
   - 피트 빌딩 / 그랜드스탠드 / 스타트 갠트리 / 브레이킹 보드
   - 나무(Instancing) / 원경 산 / 호수
   모든 트랙 구조물은 같은 샘플 기준선 위에서 생성하고,
   다른 구간의 도로를 침범하는 부분은 자동으로 잘라낸다.
========================================================= */
"use strict";

/* ---------------------------------------------------------
   SKY
--------------------------------------------------------- */
function createSkyMaterial(withClouds){
    return new THREE.ShaderMaterial({
        uniforms: {
            topColor: {value: SKY_TOP},
            horizonColor: {value: SKY_HORIZON},
            groundColor: {value: SKY_GROUND},
            sunDir: {value: SUN_DIR},
            sunColor: {value: new THREE.Color(1, .93, .8)},
            time: {value: 0}
        },
        defines: withClouds ? {CLOUDS: 1} : {},
        vertexShader: `
            varying vec3 vDir;
            void main(){
                vDir = position;
                vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = p.xyww;
            }`,
        fragmentShader: `
            uniform vec3 topColor, horizonColor, groundColor, sunDir, sunColor;
            uniform float time;
            varying vec3 vDir;
            float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p){
                vec2 i = floor(p), f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            void main(){
                vec3 d = normalize(vDir);
                float h = d.y;
                vec3 col = h > 0.0
                    ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.5))
                    : mix(horizonColor, groundColor, pow(clamp(-h, 0.0, 1.0), 0.35));
                float sd = max(dot(d, sunDir), 0.0);
                col += sunColor * (pow(sd, 1200.0) * 8.0 + pow(sd, 10.0) * 0.22);
                #ifdef CLOUDS
                if(h > 0.0){
                    vec2 uv = d.xz / (h + 0.08) * 1.4 + vec2(time * 0.006, time * 0.002);
                    float n = noise(uv) * 0.5 + noise(uv * 2.03) * 0.25 + noise(uv * 4.11) * 0.125 + noise(uv * 8.3) * 0.0625;
                    float c = smoothstep(0.52, 0.86, n) * smoothstep(0.0, 0.18, h);
                    vec3 cloud = mix(vec3(0.78, 0.8, 0.84), vec3(1.0), smoothstep(0.55, 0.9, n)) + sunColor * pow(sd, 6.0) * 0.25;
                    col = mix(col, cloud, c * 0.85);
                }
                #endif
                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
    });
}

const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), createSkyMaterial(QUALITY.clouds));
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

// 환경맵: 하늘을 한 번만 PMREM 으로 구워 차체/물/도로 반사에 사용 (런타임 비용 0)
{
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial(false));
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, .02).texture;
    pmrem.dispose();
    envSky.geometry.dispose();
    envSky.material.dispose();
}

/* ---------------------------------------------------------
   LIGHTS
--------------------------------------------------------- */
const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4d5a3c, 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
sun.position.copy(SUN_DIR).multiplyScalar(120);
scene.add(sun);
scene.add(sun.target);

if(QUALITY.shadows){
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const c = sun.shadow.camera;
    c.left = -16; c.right = 16; c.top = 16; c.bottom = -16;
    c.near = 40; c.far = 220;
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .03;
}

/** 그림자 카메라가 차량을 따라다니게 한다 (작은 영역 = 높은 해상도) */
function updateSunFollow(target){
    sun.target.position.set(target.x, 0, target.z);
    sun.position.set(target.x + SUN_DIR.x * 120, SUN_DIR.y * 120, target.z + SUN_DIR.z * 120);
}

/* ---------------------------------------------------------
   TEXTURES (절차적 생성)
--------------------------------------------------------- */
const envRng = createRng(20101024); // 2010 Korean GP

const asphaltTexture = makeCanvasTexture(512, 256, (ctx, w, h) => {
    // u = 트랙 진행 방향, v = 트랙 횡방향 (0 = 왼쪽 가장자리)
    ctx.fillStyle = "#34373a";
    ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, envRng, 9000, ["#2a2c2f", "#3e4145", "#45484c", "#2f3134", "#505357"], 1, 2.2, .55);
    // 레이싱 라인 고무 자국 (중앙부 약간 어둡게)
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(.32, "rgba(0,0,0,.10)");
    g.addColorStop(.5, "rgba(0,0,0,.16)");
    g.addColorStop(.68, "rgba(0,0,0,.10)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 흰색 경계선 (폭 약 0.25m)
    ctx.fillStyle = "#e9ecee";
    ctx.fillRect(0, h * .008, w, h * .016);
    ctx.fillRect(0, h * .976, w, h * .016);
    // 보수 자국
    ctx.globalAlpha = .18;
    for(let i = 0; i < 5; i++){
        ctx.fillStyle = envRng() > .5 ? "#202224" : "#4a4d51";
        ctx.fillRect(envRng() * w, h * (.15 + envRng() * .7), 20 + envRng() * 60, 6 + envRng() * 14);
    }
    ctx.globalAlpha = 1;
}, {wrapT: THREE.ClampToEdgeWrapping});

const plainAsphaltTexture = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#3b3e42";
    ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, envRng, 4000, ["#2d3033", "#46494d", "#55585c"], 1, 2, .5);
});

const grassTexture = makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#3f6b2c";
    ctx.fillRect(0, 0, w, h);
    // 넓은 얼룩 (반복 패턴 완화)
    for(let i = 0; i < 40; i++){
        const r = 30 + envRng() * 90;
        const x = envRng() * w, y = envRng() * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const c = envRng() > .5 ? "rgba(84,124,52,.35)" : "rgba(46,82,34,.35)";
        g.addColorStop(0, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        for(const ox of [-w, 0, w]) for(const oy of [-h, 0, h]){
            ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
        }
    }
    noiseFill(ctx, w, h, envRng, 26000, ["#355d25", "#4b7a33", "#5a8a3b", "#2f5221", "#6b9446"], 1, 2.4, .5);
});
grassTexture.repeat.set(1, 1);

const kerbTexture = makeCanvasTexture(64, 16, (ctx, w, h) => {
    ctx.fillStyle = "#d4161f"; ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = "#f1f1f1"; ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(0, h - 3, w, 3);
});

const wallTexture = makeCanvasTexture(1024, 64, (ctx, w, h) => {
    const boards = [
        ["#f4f4f4", "#c8102e", "YEONGAM"],
        ["#c8102e", "#ffffff", "KOREA GP"],
        ["#14306b", "#ffffff", "F1 SIM"],
        ["#f4f4f4", "#14306b", "5.615 KM"],
        ["#111111", "#f2c300", "MOKPO"],
        ["#f4f4f4", "#111111", "18 TURNS"],
        ["#c8102e", "#ffffff", "JEOLLANAM-DO"],
        ["#14306b", "#ffffff", "SAFETY FIRST"]
    ];
    const bw = w / boards.length;
    boards.forEach(([bg, fg, text], i) => {
        ctx.fillStyle = bg;
        ctx.fillRect(i * bw, 0, bw, h);
        ctx.fillStyle = fg;
        ctx.font = "bold 30px Arial, Helvetica, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, i * bw + bw / 2, h / 2 + 2, bw - 12);
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.fillRect(i * bw, 0, 2, h);
    });
    ctx.fillStyle = "#cfd2d4"; ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = "#6c7074"; ctx.fillRect(0, h - 6, w, 6);
});

const fenceTexture = makeCanvasTexture(64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(40,44,48,.9)";
    ctx.lineWidth = 1.5;
    for(let i = -w; i < w * 2; i += 8){
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke();
    }
    ctx.fillStyle = "rgba(30,32,36,1)";
    ctx.fillRect(0, 0, 4, h);
    ctx.fillRect(0, 0, w, 3);
});

const crowdTexture = makeCanvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = "#3a3f46";
    ctx.fillRect(0, 0, w, h);
    if(!QUALITY.crowd) return;
    const shirts = ["#d22", "#fff", "#222", "#ffcc00", "#1e4bd2", "#e66", "#f4f4f4", "#c8102e", "#2a8", "#999"];
    for(let row = 0; row < 4; row++){
        for(let x = 2; x < w; x += 6 + envRng() * 3){
            if(envRng() < .12) continue;
            const y = row * 16 + 6;
            ctx.fillStyle = shirts[(envRng() * shirts.length) | 0];
            ctx.fillRect(x, y, 5, 8);
            ctx.fillStyle = envRng() > .3 ? "#d9a582" : "#3b2a20";
            ctx.fillRect(x + 1, y - 4, 3, 4);
        }
    }
});

const garageTexture = makeCanvasTexture(512, 64, (ctx, w, h) => {
    ctx.fillStyle = "#e6e8ea"; ctx.fillRect(0, 0, w, h);
    const teams = ["#c8102e", "#14306b", "#00a19b", "#ff8000", "#1f1f1f", "#2d6a3e", "#f2f2f2", "#6c1d8f"];
    for(let i = 0; i < 8; i++){
        const x = i * 64;
        ctx.fillStyle = "#b9bdc1"; ctx.fillRect(x, 0, 64, h);
        ctx.fillStyle = "#24282c"; ctx.fillRect(x + 6, 14, 52, h - 14);
        ctx.fillStyle = teams[i]; ctx.fillRect(x + 6, 6, 52, 8);
        ctx.fillStyle = "rgba(255,255,255,.08)";
        for(let y = 18; y < h; y += 5) ctx.fillRect(x + 6, y, 52, 1);
    }
});

const glassTexture = makeCanvasTexture(256, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#9fc3d8"); g.addColorStop(1, "#2c4656");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#c9cdd1";
    for(let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
    ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, h - 4, w, 4);
});

/* ---------------------------------------------------------
   MATERIALS
--------------------------------------------------------- */
// PBR(Standard) 도로/유리/수면은 high 에서만 — medium 에서 Lambert 로 렌더 시간 약 -18%
// Lambert 에는 환경맵(하늘) 반사가 없어 어두워지므로, 색 배율(선형)로 Standard 화면 밝기에 맞췄다.
// (medium 스크린샷에서 도로 근/원거리, 피트 유리, 호수 평균 RGB 가 Standard 결과와 ±2 이내)
const useStandard = QUALITY_NAME === "high";

const roadMaterial = useStandard
    ? new THREE.MeshStandardMaterial({map: asphaltTexture, roughness: .88, metalness: 0, envMapIntensity: .35})
    : new THREE.MeshLambertMaterial({map: asphaltTexture, color: new THREE.Color(1.56, 1.56, 1.56)});
roadMaterial.polygonOffset = true;
roadMaterial.polygonOffsetFactor = -2;
roadMaterial.polygonOffsetUnits = -2;

const pitLaneMaterial = new THREE.MeshLambertMaterial({map: plainAsphaltTexture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
const kerbMaterial = new THREE.MeshLambertMaterial({map: kerbTexture, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4});
const wallMaterial = new THREE.MeshLambertMaterial({map: wallTexture, side: THREE.DoubleSide});
const fenceMaterial = new THREE.MeshLambertMaterial({map: fenceTexture, side: THREE.DoubleSide, alphaTest: .45, transparent: false});
const concreteMaterial = new THREE.MeshLambertMaterial({color: 0xb7b9b6, side: THREE.DoubleSide});
const darkMetalMaterial = new THREE.MeshLambertMaterial({color: 0x2a2e33, side: THREE.DoubleSide});
const crowdMaterial = new THREE.MeshLambertMaterial({map: crowdTexture, side: THREE.DoubleSide});
const garageMaterial = new THREE.MeshLambertMaterial({map: garageTexture, side: THREE.DoubleSide});
const glassMaterial = useStandard
    ? new THREE.MeshStandardMaterial({map: glassTexture, roughness: .08, metalness: .3, side: THREE.DoubleSide})
    : new THREE.MeshLambertMaterial({map: glassTexture, color: new THREE.Color(3.47, 3.47, 3.47), side: THREE.DoubleSide});
const whitePaintMaterial = new THREE.MeshLambertMaterial({color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6});

/* ---------------------------------------------------------
   GROUND
--------------------------------------------------------- */
{
    const size = 9000;
    // 큰 삼각형은 일부 GPU 에서 깊이 보간 오차로 도로 위에 비쳐 보이므로 잘게 나눈다.
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    const uv = geo.attributes.uv;
    for(let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 36, uv.getY(i) * size / 36);
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({map: grassTexture}));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(trackCenter.x, -.06, trackCenter.z);
    ground.receiveShadow = true;
    scene.add(ground);
}

/* ---------------------------------------------------------
   TRACK EXTRUSION HELPERS
--------------------------------------------------------- */

/** 샘플 i 의 기준선에서 side(+1 오른쪽 / -1 왼쪽) 방향으로 offset 만큼 떨어진 점 */
function trackPoint(i, side, offset){
    const p = sampleAt(i);
    return [p.x + p.rx * side * offset, p.z + p.rz * side * offset];
}

/**
 * 구조물이 다른 구간 도로를 침범하지 않는지 검사.
 * 해당 오프셋의 점에서 가장 가까운 트랙까지 거리가 오프셋보다 확연히 작으면
 * (= 다른 구간의 도로가 더 가깝다) 침범으로 본다.
 */
function isClearOfTrack(i, side, offsets, tolerance = 1.5){
    for(const o of offsets){
        const [x, z] = trackPoint(i, side, o);
        if(nearestTrackDistance(x, z) < Math.abs(o) - tolerance) return false;
    }
    return true;
}

/** 유효 샘플 배열 → 연속 구간(run) 목록 */
function collectRuns(from, to, step, isValid){
    const runs = [];
    let run = [];
    for(let i = from; i <= to; i += step){
        const idx = ((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
        if(isValid(idx)) run.push(idx);
        else { if(run.length > 1) runs.push(run); run = []; }
    }
    if(run.length > 1) runs.push(run);
    return runs;
}

/**
 * 프로파일(단면)을 트랙을 따라 압출한다.
 * profile: [[offset, y], ...] (offset 은 side 방향 거리)
 * u = 진행 거리 / uScale,  v = 단면 누적 길이 / vScale
 */
function extrudeRuns(runs, side, profile, {uScale = 8, vScale = 1, step = 1, caps = false, capsOnly = false, flipU = false} = {}){
    const positions = [];
    const uvs = [];
    const indices = [];
    const pc = profile.length;

    const vAcc = [0];
    for(let k = 1; k < pc; k++){
        vAcc.push(vAcc[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    }

    for(const run of runs){
        const base = positions.length / 3;
        run.forEach((idx, j) => {
            for(let k = 0; k < pc; k++){
                const [x, z] = trackPoint(idx, side, profile[k][0]);
                positions.push(x, profile[k][1], z);
                uvs.push((flipU ? -j : j) * step * SAMPLE_SPACING / uScale, vAcc[k] / vScale);
            }
        });
        for(let j = 0; j < run.length - 1 && !capsOnly; j++){
            for(let k = 0; k < pc - 1; k++){
                const a = base + j * pc + k;
                const b = a + pc;
                if(side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
                else indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        if(caps || capsOnly){
            // 단면 끝 마감 (계단형 단면은 뒤쪽 아래 꼭짓점 기준으로 별모양)
            for(const j of [0, run.length - 1]){
                const start = positions.length / 3;
                const idx = run[j];
                for(let k = 0; k < pc; k++){
                    const [x, z] = trackPoint(idx, side, profile[k][0]);
                    positions.push(x, profile[k][1], z);
                    uvs.push(0, 0);
                }
                for(let k = 1; k < pc - 1; k++) indices.push(start, start + k, start + k + 1);
            }
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

function addTrackMesh(geometry, material, {shadow = false} = {}){
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = shadow;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    return mesh;
}

/* ---------------------------------------------------------
   ROAD
--------------------------------------------------------- */
{
    const run = [];
    for(let i = 0; i <= SAMPLE_COUNT; i++) run.push(i % SAMPLE_COUNT);
    const geo = extrudeRuns([run], 1, [[-ROAD_WIDTH / 2 - .02, .02], [ROAD_WIDTH / 2 + .02, .02]], {uScale: 16, vScale: ROAD_WIDTH + .04});
    addTrackMesh(geo, roadMaterial, {shadow: true});
}

/* ---------------------------------------------------------
   KERBS — 바깥쪽으로 살짝 솟은 빨강/흰색 연석
--------------------------------------------------------- */
for(const side of [1, -1]){
    const mask = kerbMask[side > 0 ? 0 : 1];
    const inner = ROAD_WIDTH / 2 - .05, outer = ROAD_WIDTH / 2 + KERB_WIDTH;
    const runs = collectRuns(0, SAMPLE_COUNT, 1, i => mask[i] && isClearOfTrack(i, side, [outer]));
    const geo = extrudeRuns(runs, side, [[inner, .022], [outer - .25, .075], [outer, .075], [outer + .05, 0]], {uScale: 3, vScale: 2});
    addTrackMesh(geo, kerbMaterial, {shadow: true});
}

/* ---------------------------------------------------------
   GRAVEL TRAPS — 저속 코너 바깥 (물리: 그립 0.5, 큰 저항)
--------------------------------------------------------- */
const gravelTexture = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#b9a98a";
    ctx.fillRect(0, 0, w, h);
    noiseFill(ctx, w, h, envRng, 16000, ["#a08f70", "#cdbf9f", "#8f7f63", "#d8ccb0", "#9a8a6c"], 1, 2.6, .8);
});
const gravelMaterial = new THREE.MeshLambertMaterial({map: gravelTexture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
for(const side of [1, -1]){
    const mask = gravelMask[side > 0 ? 0 : 1];
    const inner = ROAD_WIDTH / 2 + KERB_WIDTH + .04, outer = WALL_OFFSET - .8;
    const runs = collectRuns(0, SAMPLE_COUNT, 1, i => mask[i] && isClearOfTrack(i, side, [outer], 2));
    if(runs.length){
        addTrackMesh(extrudeRuns(runs, side, [[ROAD_WIDTH / 2 + .05, .008], [outer, .008]], {uScale: 8, vScale: 8}), gravelMaterial, {shadow: true});
    }
}

/* ---------------------------------------------------------
   WALLS + CATCH FENCE
--------------------------------------------------------- */
for(const side of [1, -1]){
    const mask = wallMask[side > 0 ? 0 : 1];
    const W = WALL_OFFSET;
    const runs = collectRuns(0, SAMPLE_COUNT, 2, i => isClearOfTrack(i, side, [W, W + .5], 2.5));
    for(const run of runs){
        for(let j = 0; j < run.length - 1; j++){
            mask[run[j]] = 1;
            mask[(run[j] + 1) % SAMPLE_COUNT] = 1;
        }
        mask[run[run.length - 1]] = 1;
    }
    // 오른쪽 벽은 u 를 뒤집어 광고 글자가 거울상으로 보이지 않게 한다.
    addTrackMesh(extrudeRuns(runs, side, [[W, 0], [W, 1.1], [W + .45, 1.1]], {uScale: 64, vScale: 1.1, step: 2, flipU: side > 0}), wallMaterial);
    if(QUALITY.catchFence){
        addTrackMesh(extrudeRuns(runs, side, [[W + .2, 1.1], [W + .45, 4.1]], {uScale: 4, vScale: 1, step: 2}), fenceMaterial);
    }
}

/* ---------------------------------------------------------
   START LINE / GRID
--------------------------------------------------------- */
const startYaw = Math.atan2(-trackSamples[0].tx, -trackSamples[0].tz);
{
    const checker = makeCanvasTexture(128, 16, (ctx, w, h) => {
        for(let x = 0; x < w; x += 8) for(let y = 0; y < h; y += 8){
            ctx.fillStyle = ((x + y) / 8) % 2 ? "#111" : "#f4f4f4";
            ctx.fillRect(x, y, 8, 8);
        }
    }, {wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
    const line = new THREE.Mesh(
        new THREE.PlaneGeometry(ROAD_WIDTH, 1.0),
        new THREE.MeshLambertMaterial({map: checker, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6})
    );
    line.rotation.order = "YXZ";
    line.rotation.set(-Math.PI / 2, startYaw, 0);
    line.position.set(trackSamples[0].x, .03, trackSamples[0].z);
    scene.add(line);

    // 그리드 박스 (지그재그 배치)
    const parts = [];
    const tmp = new THREE.Object3D();
    for(let k = 0; k < 12; k++){
        const i = -Math.round((8 + k * 8) / SAMPLE_SPACING);
        const p = sampleAt(i);
        const lat = (k % 2 ? 1 : -1) * 3.4;
        tmp.position.set(p.x + p.rx * lat, .03, p.z + p.rz * lat);
        tmp.rotation.order = "YXZ";
        tmp.rotation.set(-Math.PI / 2, Math.atan2(-p.tx, -p.tz), 0);
        tmp.updateMatrix();
        parts.push({geometry: new THREE.PlaneGeometry(3.0, .18), matrix: tmp.matrix.clone()});
        for(const sx of [-1.45, 1.45]){
            const m = new THREE.Matrix4().makeTranslation(sx, -.5, 0);
            parts.push({geometry: new THREE.PlaneGeometry(.12, 1.0), matrix: tmp.matrix.clone().multiply(m)});
        }
    }
    scene.add(new THREE.Mesh(mergeGeometryList(parts), whitePaintMaterial));
}

/* ---------------------------------------------------------
   START GANTRY + LIGHTS
--------------------------------------------------------- */
// 램프 10개(5열 × 2행)를 InstancedMesh 하나로 그린다 (draw call 10 → 1), 색은 인스턴스별
const START_LIGHT_ON = 0xff1a1a, START_LIGHT_OFF = 0x330608;
const startLightColor = new THREE.Color();
let startLights = null;
let startLightsLit = -1;
{
    const p = trackSamples[Math.round(5 / SAMPLE_SPACING)];
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-p.tx, -p.tz);
    const span = (WALL_OFFSET + 1) * 2;
    const parts = [];
    const add = (geo, x, y, z) => parts.push({geometry: geo, matrix: new THREE.Matrix4().makeTranslation(x, y, z)});
    for(const sx of [-1, 1]) add(new THREE.BoxGeometry(.5, 8, .5), sx * span / 2, 4, 0);
    add(new THREE.BoxGeometry(span, .9, .6), 0, 7.6, 0);
    add(new THREE.BoxGeometry(5.4, 1.6, .5), 0, 6.6, .05);
    g.add(new THREE.Mesh(mergeGeometryList(parts), darkMetalMaterial));

    // 인스턴스 색이 그대로 나오도록 재질 색은 흰색 (instanceColor 와 곱해진다)
    startLights = new THREE.InstancedMesh(new THREE.CircleGeometry(.24, 14), new THREE.MeshBasicMaterial({color: 0xffffff}), 10);
    const m = new THREE.Matrix4();
    for(let i = 0; i < 5; i++){
        [6.95, 6.3].forEach((y, row) => {
            startLights.setMatrixAt(i * 2 + row, m.makeTranslation(-2.0 + i * 1.0, y, .32));
        });
    }
    startLights.instanceMatrix.needsUpdate = true;
    g.add(startLights);
    setStartLights(0);
    scene.add(g);
}

/** 점등된 열 수(0~5). hud.js 가 매 프레임 호출하므로 바뀔 때만 색 버퍼를 갱신한다 */
function setStartLights(count){
    if(count === startLightsLit || !startLights) return;
    startLightsLit = count;
    for(let k = 0; k < 10; k++){
        startLights.setColorAt(k, startLightColor.setHex((k >> 1) < count ? START_LIGHT_ON : START_LIGHT_OFF));
    }
    startLights.instanceColor.needsUpdate = true;
}

/* ---------------------------------------------------------
   PIT BUILDING / PIT LANE (메인 스트레이트 안쪽)
--------------------------------------------------------- */
const structureRanges = []; // 나무 배치 제외용

function addAlongTrack(fromM, toM, side, offsets, build){
    const from = Math.round(fromM / SAMPLE_SPACING), to = Math.round(toM / SAMPLE_SPACING);
    const runs = collectRuns(from, to, 2, i => isClearOfTrack(i, side, offsets, 2));
    if(!runs.length) return false;
    build(runs);
    structureRanges.push({runs, side, maxOffset: Math.max(...offsets)});
    return true;
}

{
    const side = -1; // 반시계 서킷 → 피트는 안쪽(왼쪽)
    const W = WALL_OFFSET;
    addAlongTrack(-300, 150, side, [W + 2, W + 32], runs => {
        addTrackMesh(extrudeRuns(runs, side, [[W + .5, .02], [W + 13, .02]], {uScale: 12, vScale: 12, step: 2}), pitLaneMaterial, {shadow: true});
        addTrackMesh(extrudeRuns(runs, side, [[W + 14, 0], [W + 14, 5]], {uScale: 64, vScale: 5, step: 2}), garageMaterial);
        addTrackMesh(extrudeRuns(runs, side, [[W + 14, 5], [W + 12.5, 5], [W + 12.5, 5.5], [W + 15.5, 5.5]], {step: 2}), concreteMaterial);
        addTrackMesh(extrudeRuns(runs, side, [[W + 15.5, 5.5], [W + 15.5, 9.5]], {uScale: 32, vScale: 4, step: 2}), glassMaterial);
        addTrackMesh(extrudeRuns(runs, side, [[W + 13.5, 9.2], [W + 13.5, 9.8], [W + 30, 9.8], [W + 30, 0]], {step: 2}), concreteMaterial);
        addTrackMesh(extrudeRuns(runs, side, [[W + 30, 0], [W + 14, 0], [W + 14, 5], [W + 15.5, 5.5], [W + 15.5, 9.8], [W + 30, 9.8]], {step: 2, capsOnly: true}), concreteMaterial);
    });
}

/* ---------------------------------------------------------
   GRANDSTANDS
--------------------------------------------------------- */
function addGrandstand(fromM, toM, side, rows = 9){
    const o0 = WALL_OFFSET + 4;
    const tread = 1.0, rise = .55, base = 1.6;
    const depth = rows * tread;
    return addAlongTrack(fromM, toM, side, [o0 - 1, o0 + depth + 1], runs => {
        const steps = [[o0, 0], [o0, base]];
        for(let r = 0; r < rows; r++){
            steps.push([o0 + r * tread + tread, base + r * rise]);
            steps.push([o0 + r * tread + tread, base + (r + 1) * rise]);
        }
        const top = base + rows * rise;
        addTrackMesh(extrudeRuns(runs, side, steps.slice(1), {uScale: 16, vScale: 2.2, step: 2}), crowdMaterial);
        addTrackMesh(extrudeRuns(runs, side, [[o0, base], [o0, 0], [o0 + depth, 0], [o0 + depth, top + 3.2]], {step: 2}), concreteMaterial);
        // 지붕
        addTrackMesh(extrudeRuns(runs, side, [[o0 - 1.2, top + 3.8], [o0 + depth + .4, top + 3.3], [o0 + depth + .4, top + 3.0], [o0 - 1.2, top + 3.6]], {step: 2, caps: true}), darkMetalMaterial);
        // 계단 측면 마감
        addTrackMesh(extrudeRuns(runs, side, [[o0 + depth, 0], ...steps], {step: 2, capsOnly: true}), concreteMaterial);
    });
}

addGrandstand(-260, 170, 1, 10);                     // 메인 스트레이트 맞은편
{
    const t1 = trackCorners.find(c => c.name === "T1");
    const t3 = trackCorners.find(c => c.name === "T3");
    const t13 = trackCorners.find(c => c.name === "T13");
    const sOf = c => (c.index * SAMPLE_SPACING);
    if(t1) addGrandstand(sOf(t1) - 40, sOf(t1) + 70, 1, 8);
    if(t3) addGrandstand(sOf(t3) - 70, sOf(t3) + 120, -1, 8);
    if(t13) addGrandstand(sOf(t13) - 60, sOf(t13) + 40, 1, 7);
}

/* ---------------------------------------------------------
   BRAKING BOARDS (150 / 100 / 50 m)
--------------------------------------------------------- */
{
    const boardMats = {};
    for(const n of ["150", "100", "50"]){
        const tex = makeCanvasTexture(64, 64, (ctx, w, h) => {
            ctx.fillStyle = "#f6f6f6"; ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#111"; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
            ctx.fillStyle = "#111"; ctx.font = "bold 28px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(n, w / 2, h / 2 + 1);
        }, {wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
        boardMats[n] = {material: new THREE.MeshLambertMaterial({map: tex}), parts: []};
    }
    const poleParts = [];
    for(const name of ["T1", "T3", "T4", "T13", "T15"]){
        const c = trackCorners.find(cc => cc.name === name);
        if(!c) continue;
        const side = c.angle > 0 ? 1 : -1; // 코너 바깥쪽
        for(const [n, d] of [["150", 150], ["100", 100], ["50", 50]]){
            const i = c.index - Math.round(d / SAMPLE_SPACING);
            const off = ROAD_WIDTH / 2 + KERB_WIDTH + 3.5;
            if(!isClearOfTrack(((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT, side, [off], 1)) continue;
            const p = sampleAt(i);
            const [x, z] = trackPoint(i, side, off);
            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(x, 1.5, z),
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.tx, -p.tz)),
                new THREE.Vector3(1, 1, 1)
            );
            boardMats[n].parts.push({geometry: new THREE.PlaneGeometry(1.3, 1.3), matrix: m});
            poleParts.push({geometry: new THREE.BoxGeometry(.08, 1.0, .08), matrix: new THREE.Matrix4().makeTranslation(x, .5, z)});
        }
    }
    for(const k in boardMats){
        if(boardMats[k].parts.length) scene.add(new THREE.Mesh(mergeGeometryList(boardMats[k].parts), boardMats[k].material));
    }
    if(poleParts.length) scene.add(new THREE.Mesh(mergeGeometryList(poleParts), darkMetalMaterial));
}

/* ---------------------------------------------------------
   LAKE (영암호 방향, 서킷 동쪽)
--------------------------------------------------------- */
const lakeShoreX = trackBounds.maxX + 110;
{
    const shape = new THREE.Shape();
    const z0 = trackBounds.minZ - 1400, z1 = trackBounds.maxZ + 1400;
    shape.moveTo(lakeShoreX + 2800, -z0);
    for(let i = 0; i <= 60; i++){
        const z = z0 + (z1 - z0) * i / 60;
        const x = lakeShoreX + Math.sin(z / 170) * 35 + Math.sin(z / 61) * 12 + 30;
        shape.lineTo(x, -z);
    }
    shape.lineTo(lakeShoreX + 2800, -z1);
    const geo = new THREE.ShapeGeometry(shape, 2);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, useStandard
        ? new THREE.MeshStandardMaterial({color: 0x24506b, roughness: .12, metalness: .1, envMapIntensity: 1.1})
        : new THREE.MeshLambertMaterial({color: 0x9dbddc}));   // 하늘이 비친 밝은 수면 색
    water.position.y = -.02;
    water.material.polygonOffset = true;
    water.material.polygonOffsetFactor = -1;
    water.material.polygonOffsetUnits = -1;
    scene.add(water);
}

/* ---------------------------------------------------------
   TREES (InstancedMesh — 수백 그루를 draw call 3개로)
--------------------------------------------------------- */
{
    const count = QUALITY.trees;
    const trunkGeo = new THREE.CylinderGeometry(.18, .28, 1, 5);
    trunkGeo.translate(0, .5, 0);
    const pineGeo = new THREE.ConeGeometry(1, 1, 7);
    pineGeo.translate(0, .5, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1, 0);

    const leafMat = new THREE.MeshLambertMaterial({color: 0xffffff, flatShading: true});
    const trunkMat = new THREE.MeshLambertMaterial({color: 0x4a3626});

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const pines = new THREE.InstancedMesh(pineGeo, leafMat, count);
    const rounds = new THREE.InstancedMesh(roundGeo, leafMat.clone(), count);

    const rng = createRng(5615);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let nPine = 0, nRound = 0, nTrunk = 0;

    // 군락 중심을 만든 뒤 주변에 흩뿌린다.
    const clusters = [];
    for(let i = 0; i < 70; i++){
        clusters.push([
            trackBounds.minX - 500 + rng() * (trackBounds.maxX - trackBounds.minX + 700),
            trackBounds.minZ - 500 + rng() * (trackBounds.maxZ - trackBounds.minZ + 1000)
        ]);
    }

    let attempts = 0;
    while(nTrunk < count && attempts < count * 12){
        attempts++;
        const c = clusters[(rng() * clusters.length) | 0];
        const x = c[0] + (rng() - .5) * 220;
        const z = c[1] + (rng() - .5) * 220;
        if(x > lakeShoreX - 10) continue;
        if(nearestTrackDistance(x, z) < WALL_OFFSET + 34) continue;

        const height = 5 + rng() * 9;
        const isPine = rng() < .55;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);

        s.set(1, height * .35, 1);
        m.compose(pos.set(x, 0, z), q, s);
        trunks.setMatrixAt(nTrunk++, m);

        if(isPine){
            const r = 1.6 + rng() * 1.6;
            s.set(r, height, r);
            m.compose(pos.set(x, height * .25, z), q, s);
            pines.setMatrixAt(nPine, m);
            pines.setColorAt(nPine++, color.setHSL(.29 + rng() * .05, .45, .18 + rng() * .08));
        }else{
            const r = 2.2 + rng() * 2.2;
            s.set(r, r * (.8 + rng() * .3), r);
            m.compose(pos.set(x, height * .35 + r * .7, z), q, s);
            rounds.setMatrixAt(nRound, m);
            rounds.setColorAt(nRound++, color.setHSL(.22 + rng() * .08, .45, .22 + rng() * .1));
        }
    }
    trunks.count = nTrunk;
    pines.count = nPine;
    rounds.count = nRound;
    for(const mesh of [trunks, pines, rounds]){
        mesh.instanceMatrix.needsUpdate = true;
        if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        // 인스턴스가 넓게 퍼져 있으므로 컬링은 끈다 (draw call 1개라 비용 미미)
        mesh.frustumCulled = false;
        scene.add(mesh);
    }
}

/* ---------------------------------------------------------
   DISTANT HILLS (원경 산)
--------------------------------------------------------- */
{
    const seg = 160;
    const R = Math.max(trackBounds.maxX - trackBounds.minX, trackBounds.maxZ - trackBounds.minZ) * .5 + 1500;
    const positions = [], colors = [], indices = [];
    const near = new THREE.Color(0x3d5a3a), peak = new THREE.Color(0x7d93a3);
    const rng = createRng(77);
    const phase = [rng() * 10, rng() * 10, rng() * 10];
    for(let i = 0; i <= seg; i++){
        const a = i / seg * Math.PI * 2;
        // 동쪽(호수 방향)은 낮게
        const eastness = Math.max(0, Math.cos(a));
        const h = (90 + 160 * (.5 + .5 * Math.sin(a * 3 + phase[0])) * (.6 + .4 * Math.sin(a * 7 + phase[1])) + 40 * Math.sin(a * 17 + phase[2])) * (1 - eastness * .75);
        const cx = trackCenter.x, cz = trackCenter.z;
        const ca = Math.cos(a), sa = Math.sin(a);
        positions.push(cx + ca * R, -5, cz + sa * R);
        positions.push(cx + ca * (R + 260), h, cz + sa * (R + 260));
        positions.push(cx + ca * (R + 700), h * .45, cz + sa * (R + 700));
        colors.push(near.r, near.g, near.b, peak.r, peak.g, peak.b, peak.r, peak.g, peak.b);
    }
    for(let i = 0; i < seg; i++){
        for(let k = 0; k < 2; k++){
            const a = i * 3 + k, b = a + 3;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide, fog: false}));
    hills.matrixAutoUpdate = false;
    scene.add(hills);
}
