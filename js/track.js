/* =========================================================
   TRACK — Korea International Circuit (Yeongam) 참고 레이아웃

   실제 서킷 정보 (검색 결과 반영)
   - 길이 5.615 km, 18개 코너 (좌 11 / 우 7), 반시계 방향
   - T1-T2: 2단 좌코너 → 약 1.15 km 백스트레이트 (최고 ~320 km/h)
   - T3: 서킷에서 가장 느린 우측 헤어핀 (2단 기어)
   - T4-T6: 2단 기어 저속 스위치백
   - T7-T10: 호수 쪽 4~5단 고속 스위핑 구간
   - T11-T16: 벽으로 둘러싸인 도심형 저속 구간
   - T17: 긴 블라인드 우코너,  T18: 메인 스트레이트로 이어지는 좌측 킹크

   정확한 측량 데이터가 아닌 "직선 길이 + 코너 각도/반경" 시퀀스로
   형태를 재구성했다. 미지의 직선 두 개(메인, T15-T16)를 계산해
   트랙이 정확히 닫히도록 만든다. 단위는 미터.
========================================================= */
"use strict";

const ROAD_WIDTH = 16;
const KERB_WIDTH = 1.6;
const WALL_OFFSET = ROAD_WIDTH / 2 + 13;   // 트랙 중심선 → 방호벽

// ["S", 길이] 직선, ["T", 각도(+좌/-우), 반경, 코너이름]
const TRACK_LAYOUT = [
    ["S", "MAIN"],
    ["T", 45, 45, "T1"], ["S", 70], ["T", 90, 40, "T2"],
    ["S", 900],                                   // 백스트레이트
    ["T", -165, 18, "T3"], ["S", 600],
    ["T", 105, 25, "T4"], ["S", 110], ["T", -50, 30, "T5"], ["S", 120], ["T", 55, 30, "T6"], ["S", 60],
    ["T", -15, 150, "T7"], ["S", 90], ["T", 65, 110, "T8"], ["S", 80], ["T", -20, 150, "T9"], ["S", 80],
    ["T", 70, 80, "T10"], ["S", 120],
    ["T", -30, 70, "T11"], ["S", 100], ["T", 30, 60, "T12"], ["S", 380],
    ["T", 90, 28, "T13"], ["S", 110], ["T", -90, 28, "T14"], ["S", 260], ["T", 90, 32, "T15"], ["S", "WEST"],
    ["T", 90, 40, "T16"], ["S", 90], ["T", -45, 110, "T17"], ["S", 140], ["T", 45, 150, "T18"]
];

// 출발선은 메인 스트레이트의 이 비율 지점
const START_LINE_FRACTION = .62;

function traceLayout(mainLength, westLength, step){
    const pts = [];
    const corners = [];
    let x = 0, y = 0, h = 0, s = 0;
    pts.push([x, y]);
    for(const seg of TRACK_LAYOUT){
        if(seg[0] === "S"){
            const len = seg[1] === "MAIN" ? mainLength : seg[1] === "WEST" ? westLength : seg[1];
            const n = Math.max(1, Math.ceil(len / step));
            for(let i = 0; i < n; i++){
                x += Math.cos(h) * len / n;
                y += Math.sin(h) * len / n;
                pts.push([x, y]);
            }
            s += len;
        }else{
            const ang = seg[1] * Math.PI / 180, R = seg[2];
            const arc = Math.abs(ang) * R;
            const n = Math.max(2, Math.ceil(arc / step));
            const sStart = s;
            for(let i = 0; i < n; i++){
                const dh = ang / n;
                x += Math.cos(h + dh / 2) * arc / n;
                y += Math.sin(h + dh / 2) * arc / n;
                h += dh;
                pts.push([x, y]);
            }
            s += arc;
            corners.push({name: seg[3], sStart, sEnd: s, angle: seg[1], radius: R});
        }
    }
    return {x, y, pts, corners, length: s};
}

const trackBuild = (() => {
    // 메인(동쪽, +x)과 WEST(남쪽, -y) 직선을 0으로 두고 끝점을 구하면
    // 그 오차가 곧 두 직선의 길이다.
    const probe = traceLayout(0, 0, 8);
    const mainLength = -probe.x;
    const westLength = probe.y;
    const full = traceLayout(mainLength, westLength, 4);
    full.mainLength = mainLength;
    return full;
})();

// 지도 좌표(x 동, y 북) → 월드 좌표(x, z = -y)
const trackCurve = new THREE.CatmullRomCurve3(
    trackBuild.pts.slice(0, -1).map(p => new THREE.Vector3(p[0], 0, -p[1])),
    true,
    "centripetal"
);
trackCurve.arcLengthDivisions = 6000;

const TRACK_LENGTH = trackCurve.getLength();
const SAMPLE_SPACING = 2.5;
const SAMPLE_COUNT = Math.round(TRACK_LENGTH / SAMPLE_SPACING);
const START_U = (trackBuild.mainLength * START_LINE_FRACTION) / trackBuild.length;

/* ---------------------------------------------------------
   TRACK SAMPLES
   모든 시스템(도로 메시, 연석, 벽, 판정, 미니맵)이 같은 샘플을 공유.
   index 0 = 출발선.
   x,z  위치 / tx,tz 진행 방향 / rx,rz 진행 방향 기준 오른쪽 / k 곡률(+좌)
--------------------------------------------------------- */
const trackSamples = [];
{
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for(let i = 0; i < SAMPLE_COUNT; i++){
        const u = (START_U + i / SAMPLE_COUNT) % 1;
        trackCurve.getPointAt(u, p);
        trackCurve.getTangentAt(u, t);
        t.y = 0; t.normalize();
        trackSamples.push({
            x: p.x, z: p.z,
            tx: t.x, tz: t.z,
            rx: -t.z, rz: t.x,
            s: i * TRACK_LENGTH / SAMPLE_COUNT,
            k: 0
        });
    }
    // 곡률: ±4 샘플(±10m) 간 진행 방향 변화량
    for(let i = 0; i < SAMPLE_COUNT; i++){
        const a = trackSamples[(i - 4 + SAMPLE_COUNT) % SAMPLE_COUNT];
        const b = trackSamples[(i + 4) % SAMPLE_COUNT];
        // 좌회전이면 양수 (x 동쪽, z 남쪽 좌표계)
        const cross = a.tz * b.tx - a.tx * b.tz;
        const dot = a.tx * b.tx + a.tz * b.tz;
        trackSamples[i].k = Math.atan2(cross, dot) / (8 * SAMPLE_SPACING);
    }
}

function sampleAt(i){
    return trackSamples[((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT];
}

/* ---------------------------------------------------------
   SPATIAL GRID — 최근접 샘플 탐색 O(1)
--------------------------------------------------------- */
const TRACK_GRID_CELL = 24;
const trackGrid = new Map();
const trackBounds = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity};

for(let i = 0; i < SAMPLE_COUNT; i++){
    const p = trackSamples[i];
    const key = Math.floor(p.x / TRACK_GRID_CELL) + "," + Math.floor(p.z / TRACK_GRID_CELL);
    if(!trackGrid.has(key)) trackGrid.set(key, []);
    trackGrid.get(key).push(i);
    trackBounds.minX = Math.min(trackBounds.minX, p.x);
    trackBounds.maxX = Math.max(trackBounds.maxX, p.x);
    trackBounds.minZ = Math.min(trackBounds.minZ, p.z);
    trackBounds.maxZ = Math.max(trackBounds.maxZ, p.z);
}
const trackCenter = new THREE.Vector3(
    (trackBounds.minX + trackBounds.maxX) / 2, 0,
    (trackBounds.minZ + trackBounds.maxZ) / 2
);

/** 반경 maxRadius 안에서 가장 가까운 샘플. 없으면 index -1 */
function nearestSampleGrid(x, z, maxRadius = 400){
    const cx = Math.floor(x / TRACK_GRID_CELL);
    const cz = Math.floor(z / TRACK_GRID_CELL);
    let best = -1, bestSq = Infinity;
    const maxRing = Math.ceil(maxRadius / TRACK_GRID_CELL);
    for(let ring = 0; ring <= maxRing; ring++){
        for(let gx = cx - ring; gx <= cx + ring; gx++){
            for(let gz = cz - ring; gz <= cz + ring; gz++){
                if(Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== ring) continue;
                const list = trackGrid.get(gx + "," + gz);
                if(!list) continue;
                for(const i of list){
                    const p = trackSamples[i];
                    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
                    if(d < bestSq){ bestSq = d; best = i; }
                }
            }
        }
        // 현재 링 바깥은 최소 ring*cell 만큼 떨어져 있으므로 조기 종료
        if(best >= 0 && Math.sqrt(bestSq) < ring * TRACK_GRID_CELL) break;
    }
    return {index: best, dist: Math.sqrt(bestSq)};
}

function nearestTrackDistance(x, z){
    return nearestSampleGrid(x, z, 600).dist;
}

/**
 * 주행 중 위치 판정. 직전 인덱스 주변만 검사해 매 프레임 비용을 최소화한다.
 * 결과: index, lateral(+ 오른쪽, m), dist
 */
const trackQueryResult = {index: 0, lateral: 0, dist: 0};
function queryTrack(x, z, hint){
    let best = -1, bestSq = Infinity;
    if(hint >= 0){
        for(let o = -40; o <= 40; o++){
            const i = (hint + o + SAMPLE_COUNT) % SAMPLE_COUNT;
            const p = trackSamples[i];
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if(d < bestSq){ bestSq = d; best = i; }
        }
    }
    // 힌트가 없거나 멀리 벗어났으면 전체 격자 탐색
    if(best < 0 || bestSq > 60 * 60){
        best = nearestSampleGrid(x, z, 2000).index;
    }
    // 이웃 샘플 사이를 보간해 정확한 횡방향 거리 계산
    const p = trackSamples[best];
    const lateral = (x - p.x) * p.rx + (z - p.z) * p.rz;
    trackQueryResult.index = best;
    trackQueryResult.lateral = lateral;
    trackQueryResult.dist = Math.abs(lateral);
    return trackQueryResult;
}

/* ---------------------------------------------------------
   KERB ZONES — 곡률이 큰 구간(반경 < 260m)만 연석을 둔다.
   kerbMask[side][i] : side 0 = 오른쪽, 1 = 왼쪽
--------------------------------------------------------- */
const kerbMask = [new Uint8Array(SAMPLE_COUNT), new Uint8Array(SAMPLE_COUNT)];
{
    const PAD = 6; // 코너 앞뒤로 15m 연장
    for(let i = 0; i < SAMPLE_COUNT; i++){
        if(Math.abs(trackSamples[i].k) > 1 / 260){
            for(let o = -PAD; o <= PAD; o++){
                const j = (i + o + SAMPLE_COUNT) % SAMPLE_COUNT;
                kerbMask[0][j] = 1;
                kerbMask[1][j] = 1;
            }
        }
    }
}

// 방호벽 존재 여부 (environment 에서 클리핑 결과로 채움)
const wallMask = [new Uint8Array(SAMPLE_COUNT), new Uint8Array(SAMPLE_COUNT)];

/* 코너 위치(브레이킹 보드 등)를 샘플 인덱스로 */
const trackCorners = trackBuild.corners.map(c => {
    const startS = trackBuild.mainLength * START_LINE_FRACTION;
    const s = ((c.sStart - startS) / trackBuild.length + 1) % 1;
    return {...c, index: Math.round(s * SAMPLE_COUNT) % SAMPLE_COUNT};
});
