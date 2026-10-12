/* =========================================================
   UTILS
   - 결정적 난수 (장면이 매번 같게 생성되도록)
   - Canvas 절차적 텍스처 (이미지 파일 없이 로딩 0)
   - 지오메트리 병합 (draw call 감소 = 모바일 최적화 핵심)
   - Loft 지오메트리 (차체 곡면 생성)
========================================================= */
"use strict";

function createRng(seed){
    let a = seed >>> 0;
    return function(){
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/* ---------------------------------------------------------
   CANVAS TEXTURE
--------------------------------------------------------- */
function makeCanvasTexture(width, height, draw, options = {}){
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    draw(ctx, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = options.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.wrapS = options.wrapS ?? THREE.RepeatWrapping;
    texture.wrapT = options.wrapT ?? THREE.RepeatWrapping;
    texture.anisotropy = options.anisotropy ?? QUALITY.anisotropy;
    if(options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
    if(options.nearest){
        texture.magFilter = THREE.NearestFilter;
    }
    return texture;
}

function noiseFill(ctx, w, h, rng, count, colors, minSize, maxSize, alpha = 1){
    ctx.globalAlpha = alpha;
    for(let i = 0; i < count; i++){
        ctx.fillStyle = colors[(rng() * colors.length) | 0];
        const s = minSize + rng() * (maxSize - minSize);
        ctx.fillRect(rng() * w, rng() * h, s, s);
    }
    ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------
   GEOMETRY MERGE
   여러 Mesh 를 재질별로 하나의 BufferGeometry 로 합친다.
   (BufferGeometryUtils 는 ES module 전용이라 직접 구현)
--------------------------------------------------------- */
function mergeGeometryList(entries){
    let total = 0;
    const prepared = entries.map(({geometry, matrix}) => {
        let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        if(matrix) g.applyMatrix4(matrix);
        if(!g.attributes.normal) g.computeVertexNormals();
        total += g.attributes.position.count;
        return g;
    });

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let offset = 0;

    for(const g of prepared){
        const n = g.attributes.position.count;
        position.set(g.attributes.position.array, offset * 3);
        normal.set(g.attributes.normal.array, offset * 3);
        if(g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
        offset += n;
        g.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    return merged;
}

/**
 * group 안의 정적 Mesh 들을 재질별로 병합하여 새 Group 으로 돌려준다.
 * keep(mesh) 가 true 인 Mesh 는 병합하지 않고 그대로 둔다 (애니메이션 부품).
 */
function mergeGroupByMaterial(group, keep = () => false){
    group.updateMatrixWorld(true);
    const inverseRoot = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map();
    const kept = [];

    group.traverse(obj => {
        if(!obj.isMesh) return;
        if(keep(obj)){ kept.push(obj); return; }
        // 부모 체인에 keep 대상이 있으면 건너뛴다.
        let p = obj.parent, skip = false;
        while(p && p !== group){ if(keep(p)){ skip = true; break; } p = p.parent; }
        if(skip) return;
        const m = new THREE.Matrix4().multiplyMatrices(inverseRoot, obj.matrixWorld);
        if(!buckets.has(obj.material)) buckets.set(obj.material, []);
        buckets.get(obj.material).push({geometry: obj.geometry, matrix: m});
    });

    const result = new THREE.Group();
    for(const [material, list] of buckets){
        const mesh = new THREE.Mesh(mergeGeometryList(list), material);
        result.add(mesh);
    }
    for(const k of kept){
        // 월드 행렬을 유지한 채로 새 그룹으로 옮긴다.
        const m = new THREE.Matrix4().multiplyMatrices(inverseRoot, k.matrixWorld);
        k.parent.remove(k);
        m.decompose(k.position, k.quaternion, k.scale);
        result.add(k);
    }
    return result;
}

/* ---------------------------------------------------------
   LOFT GEOMETRY
   z 축을 따라 단면(초타원)을 이어 붙여 노즈/모노코크/사이드포드 같은
   매끄러운 곡면을 만든다.
   station: { z, w, h, y, x=0, hb=h (아래 절반 높이), n=2.4 (단면 각짐 정도) }
--------------------------------------------------------- */
function loftGeometry(stations, radialSegments = 18, capStart = true, capEnd = true){
    const positions = [];
    const uvs = [];
    const indices = [];
    const ring = radialSegments + 1;

    const sectionPoint = (st, a) => {
        const n = st.n ?? 2.4;
        const c = Math.cos(a), s = Math.sin(a);
        const px = (st.w) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
        const hh = s >= 0 ? st.h : (st.hb ?? st.h);
        const py = hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
        return [(st.x || 0) + px, st.y + py, st.z];
    };

    stations.forEach((st, si) => {
        for(let i = 0; i <= radialSegments; i++){
            // 이음매를 바닥 중앙(-PI/2)에 두어 보이지 않게 한다.
            const a = -Math.PI / 2 + (i / radialSegments) * Math.PI * 2;
            const p = sectionPoint(st, a);
            positions.push(p[0], p[1], p[2]);
            uvs.push(i / radialSegments, si / (stations.length - 1));
        }
    });

    for(let si = 0; si < stations.length - 1; si++){
        for(let i = 0; i < radialSegments; i++){
            const a = si * ring + i;
            const b = a + ring;
            // 바깥을 향하도록 감는 방향 결정 (z 감소 방향 = 차량 전방)
            indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }

    const addCap = (st, reverse) => {
        const center = positions.length / 3;
        positions.push(st.x || 0, st.y, st.z);
        uvs.push(.5, .5);
        const start = positions.length / 3;
        for(let i = 0; i <= radialSegments; i++){
            const a = -Math.PI / 2 + (i / radialSegments) * Math.PI * 2;
            const p = sectionPoint(st, a);
            positions.push(p[0], p[1], p[2]);
            uvs.push(.5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5);
        }
        for(let i = 0; i < radialSegments; i++){
            if(reverse) indices.push(center, start + i + 1, start + i);
            else indices.push(center, start + i, start + i + 1);
        }
    };

    const forward = stations[stations.length - 1].z > stations[0].z;
    // forward 기준으로 감고, 역방향이면 아래에서 전체를 뒤집는다.
    if(capStart) addCap(stations[0], true);
    if(capEnd) addCap(stations[stations.length - 1], false);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    if(!forward) {
        // 역방향 로프트는 면 방향을 뒤집는다.
        const idx = geo.index.array;
        for(let i = 0; i < idx.length; i += 3){ const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
    geo.computeVertexNormals();
    return geo;
}

/** 얇은 날개(윙) 단면: 앞쪽이 둥글고 뒤가 뾰족한 에어포일을 x 방향으로 압출 */
function airfoilGeometry(span, chord, thickness, camber = .25){
    const shape = new THREE.Shape();
    const pts = 14;
    for(let i = 0; i <= pts; i++){
        const t = i / pts;
        const x = t * chord;
        const yt = 5 * thickness * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
        const yc = camber * thickness * 4 * t * (1 - t);
        if(i === 0) shape.moveTo(x, yc + yt); else shape.lineTo(x, yc + yt);
    }
    for(let i = pts; i >= 0; i--){
        const t = i / pts;
        const x = t * chord;
        const yt = 5 * thickness * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
        const yc = camber * thickness * 4 * t * (1 - t);
        shape.lineTo(x, yc - yt);
    }
    const geo = new THREE.ExtrudeGeometry(shape, {depth: span, bevelEnabled: false, curveSegments: 4});
    // 압출 방향(z)을 차량 좌우(x)로, 코드 방향(x)을 차량 전후(z)로 바꾼다.
    geo.translate(0, 0, -span / 2);
    // 앞전(leading edge)이 -z(전방)를 향하도록 회전 후 중심 정렬
    geo.rotateY(-Math.PI / 2);
    geo.translate(0, 0, -chord / 2);
    return geo;
}
