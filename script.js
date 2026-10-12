/* =========================================================
   THREE.JS
========================================================= */

const canvas =
    document.getElementById("game");

const scene =
    new THREE.Scene();

scene.background =
    new THREE.Color(0x879faa);

scene.fog =
    new THREE.Fog(
        0x879faa,
        180,
        1500
    );


const camera =
    new THREE.PerspectiveCamera(
        78,
        innerWidth / innerHeight,
        0.05,
        2500
    );


const renderer =
    new THREE.WebGLRenderer({
        canvas:canvas,
        antialias:false,
        powerPreference:"high-performance"
    });

renderer.setSize(
    innerWidth,
    innerHeight
);

// 성능 최적화: 고해상도 디스플레이에서 과도한 픽셀 렌더링을 줄인다.
// 화면 크기는 CSS 기준으로 유지하고 내부 렌더링 해상도만 제한한다.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

// 실시간 그림자는 이 씬의 GPU 부하가 크므로 기본 비활성화.
// 차량/트랙/노면 색상과 조작에는 영향을 주지 않는다.
renderer.shadowMap.enabled = false;
renderer.shadowMap.autoUpdate = false;


/* =========================================================
   LIGHT
========================================================= */

const hemi =
    new THREE.HemisphereLight(
        0xffffff,
        0x46553e,
        1.8
    );

scene.add(hemi);


const sun =
    new THREE.DirectionalLight(
        0xffffff,
        2.2
    );

sun.position.set(
    300,
    500,
    200
);

sun.castShadow = false;

scene.add(sun);


/* =========================================================
   GROUND
========================================================= */

const ground =
    new THREE.Mesh(
        new THREE.PlaneGeometry(
            5000,
            5000
        ),
        new THREE.MeshBasicMaterial({
            color:0x286b35,
            side:THREE.DoubleSide
        })
    );

ground.rotation.x =
    -Math.PI/2;

ground.position.y =
    -0.08;

ground.receiveShadow = true;

scene.add(ground);


/* =========================================================
   TRACK
========================================================= */

const controlPoints = [
    // Yeongam Korea International Circuit 참고 배치:
    // 아래쪽 출발/결승 직선에서 오른쪽 하단으로 이어지는 긴 직선,
    // 상단의 고속 구간, 왼쪽의 복합 코너와 하단의 중저속 코너를 재현.
    [-245,0,245],
    [-165,0,135],
    [-75,0,15],
    [20,0,-95],
    [115,0,-205],
    [205,0,-300],
    [300,0,-285],
    [355,0,-220],
    [330,0,-150],
    [270,0,-125],
    [300,0,-65],
    [365,0,-20],
    [350,0,65],
    [295,0,115],
    [220,0,100],
    [175,0,55],
    [125,0,85],
    [75,0,145],
    [5,0,165],
    [-45,0,125],
    [-100,0,155],
    [-160,0,130],
    [-205,0,75],
    [-230,0,15],
    [-280,0,-35],
    [-325,0,5],
    [-310,0,75],
    [-270,0,120],
    [-290,0,175],
    [-270,0,220]
];


const trackCurve =
    new THREE.CatmullRomCurve3(

        controlPoints.map(
            p =>
                new THREE.Vector3(
                    p[0],
                    p[1],
                    p[2]
                )
        ),

        true,
        "catmullrom",
        .18
    );


/* =========================================================
   ROAD
========================================================= */

const roadWidth = 18;
const roadSegments = 2200;

// 트랙의 실제 중심선을 고밀도로 샘플링한다.
// 도로 판정, 구조물 배치, 미니맵이 모두 같은 기준선을 사용한다.
const trackSamples = [];
for(let i=0;i<=roadSegments;i++){
    trackSamples.push(trackCurve.getPointAt(i/roadSegments));
}

function nearestTrackDistance(x,z){
    let minSq=Infinity;
    for(let i=0;i<trackSamples.length;i++){
        const p=trackSamples[i];
        const dx=x-p.x;
        const dz=z-p.z;
        const d=dx*dx+dz*dz;
        if(d<minSq) minSq=d;
    }
    return Math.sqrt(minSq);
}

// 주행 중 노면 판정용 빠른 최근접 거리 탐색.
// 전체 샘플을 1개씩 검사하는 대신 넓게 후보를 찾은 뒤 주변 샘플만 정밀 검사한다.
// 구조물 배치용 정확한 nearestTrackDistance()는 그대로 유지한다.
function nearestTrackDistanceFast(x,z){
    const count=trackSamples.length;
    const stride=4;
    let bestIndex=0;
    let minSq=Infinity;
    for(let i=0;i<count;i+=stride){
        const p=trackSamples[i];
        const dx=x-p.x, dz=z-p.z;
        const d=dx*dx+dz*dz;
        if(d<minSq){ minSq=d; bestIndex=i; }
    }
    // 가장 가까운 coarse sample 주변을 정밀 검사한다. 트랙은 폐곡선이다.
    for(let offset=-stride;offset<=stride;offset++){
        let i=(bestIndex+offset+count)%count;
        const p=trackSamples[i];
        const dx=x-p.x, dz=z-p.z;
        const d=dx*dx+dz*dz;
        if(d<minSq) minSq=d;
    }
    return Math.sqrt(minSq);
}

const roadVertices = [];
const roadIndices = [];


for(
    let i=0;
    i<=roadSegments;
    i++
){

    const t =
        i/roadSegments;

    const p =
        trackCurve.getPointAt(t);

    const tangent =
        trackCurve
        .getTangentAt(t)
        .normalize();

    const side =
        new THREE.Vector3(
            -tangent.z,
            0,
            tangent.x
        ).normalize();

    const left =
        p.clone().add(
            side.clone()
            .multiplyScalar(
                roadWidth/2
            )
        );

    const right =
        p.clone().add(
            side.clone()
            .multiplyScalar(
                -roadWidth/2
            )
        );

    roadVertices.push(
        left.x,0.015,left.z,
        right.x,0.015,right.z
    );
}


for(
    let i=0;
    i<roadSegments;
    i++
){

    const a=i*2;
    const b=a+1;
    const c=a+2;
    const d=a+3;

    roadIndices.push(
        a,b,c,
        b,d,c
    );
}


const roadGeometry =
    new THREE.BufferGeometry();

roadGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
        roadVertices,
        3
    )
);

roadGeometry.setIndex(
    roadIndices
);

roadGeometry.computeVertexNormals();


const road =
    new THREE.Mesh(
        roadGeometry,
        new THREE.MeshBasicMaterial({
            color:0x050505,
            side:THREE.DoubleSide
        })
    );

road.receiveShadow = true;

scene.add(road);


/* =========================================================
   ROAD EDGE
========================================================= */

function createRoadEdge(offset){

    const points=[];

    for(
        let i=0;
        i<=roadSegments;
        i++
    ){

        const t =
            i/roadSegments;

        const p =
            trackCurve.getPointAt(t);

        const tangent =
            trackCurve
            .getTangentAt(t)
            .normalize();

        const side =
            new THREE.Vector3(
                -tangent.z,
                0,
                tangent.x
            ).normalize();

        points.push(
            p.clone().add(
                side.multiplyScalar(offset)
            )
        );
    }

    const geometry =
        new THREE.BufferGeometry()
        .setFromPoints(points);

    return new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
            color:0xffffff
        })
    );
}


scene.add(
    createRoadEdge(roadWidth/2 + 0.03)
);

scene.add(
    createRoadEdge(-(roadWidth/2 + 0.03))
);


/* =========================================================
   F1 CIRCUIT DETAILS
   - curbs / painted run-off
   - safety barriers
   - pit wall / grandstands / marshal posts
   모든 구조물은 도로 바깥에 배치하여 주행 공간을 침범하지 않는다.
========================================================= */

const curbWidth = 1.05;
const curbOffset = roadWidth/2 + curbWidth/2;

// 구조물이 곡선 구간에서 도로 안으로 파고드는 것을 막기 위한 배치 함수.
// 구조물의 길이/깊이를 고려해 여러 지점을 검사하고 안전한 외측 거리를 찾는다.
function getSafeStructureOffset(t,sign,halfLongitudinal,halfLateral,extra=1.0){
    /*
       구조물의 실제 footprint를 기준으로 배치한다.
       BoxGeometry의 local X = 트랙 횡방향, local Z = 트랙 진행방향이므로
       길이/깊이를 뒤집어 검사하지 않도록 명확하게 분리한다.

       곡선 구간에서는 중심점만 검사하면 모서리가 도로를 침범할 수 있으므로
       네 모서리 + 변의 중간점까지 검사한다.
    */
    const tt=((t%1)+1)%1;
    const p=trackCurve.getPointAt(tt);
    const tangent=trackCurve.getTangentAt(tt).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();

    let offset=roadWidth/2+curbWidth+extra+0.5;

    for(let attempt=0;attempt<120;attempt++){
        let safe=true;

        // footprint의 5 x 5 지점을 실제 tangent/side 좌표로 검사
        for(let j=-2;j<=2 && safe;j++){
            const longitudinal=halfLongitudinal*(j/2);
            for(let k=-2;k<=2;k++){
                const lateral=halfLateral*(k/2);
                const test=p.clone()
                    .add(tangent.clone().multiplyScalar(longitudinal))
                    .add(side.clone().multiplyScalar(sign*(offset+lateral)));

                if(nearestTrackDistance(test.x,test.z) <= roadWidth/2+0.65){
                    safe=false;
                    break;
                }
            }
        }

        if(safe) return offset;
        offset+=0.75;
    }

    return offset;
}
function createCurbSide(sign){

    const group = new THREE.Group();
    const redMat = new THREE.MeshStandardMaterial({color:0xd71920, roughness:.82});
    const yellowMat = new THREE.MeshStandardMaterial({color:0xf2c300, roughness:.82});
    const curbSegments = 180;

    for(let i=0;i<curbSegments;i++){
        const t=(i+.5)/curbSegments;
        const p=trackCurve.getPointAt(t);
        const tangent=trackCurve.getTangentAt(t).normalize();
        const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
        const center=p.clone().add(side.multiplyScalar(sign*curbOffset));
        const t2=Math.min(1,(i+1)/curbSegments);
        const p2=trackCurve.getPointAt(t2);
        const segmentLength=p.distanceTo(p2)+.10;

        const block=new THREE.Mesh(
            new THREE.BoxGeometry(curbWidth,.13,segmentLength),
            (i%2===0 ? redMat : yellowMat)
        );
        block.position.set(center.x,.08,center.z);
        block.rotation.y=Math.atan2(-tangent.x,-tangent.z);
        block.castShadow=true;
        block.receiveShadow=true;
        group.add(block);
    }

    scene.add(group);
}

// 코너에서 개별 커브 박스가 서로 겹치거나 도로 메시를 침범하지 않도록 비활성화한다.

function createRunoffStrip(sign, offset, width, color, segments=420){
    const vertices=[];
    const indices=[];

    for(let i=0;i<=segments;i++){
        const t=i/segments;
        const p=trackCurve.getPointAt(t);
        const tangent=trackCurve.getTangentAt(t).normalize();
        const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
        const outer=p.clone().add(side.clone().multiplyScalar(sign*(offset+width)));
        const inner=p.clone().add(side.clone().multiplyScalar(sign*offset));
        vertices.push(inner.x,.018,inner.z,outer.x,.018,outer.z);
    }

    for(let i=0;i<segments;i++){
        const a=i*2,b=a+1,c=a+2,d=a+3;
        indices.push(a,b,c,b,d,c);
    }

    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:1,metalness:0}));
    mesh.receiveShadow=true;
    scene.add(mesh);
}

// 좁은 색상 런오프를 추가해 실제 서킷의 포장 영역을 강조한다.
// 별도 런오프 메시도 곡선에서 도로와 겹칠 수 있어 비활성화한다.
// 도로 가장자리는 도로 경계선으로만 표시한다.

function addBarrierSection(t, sign, length=18){
    const p=trackCurve.getPointAt(t%1);
    const tangent=trackCurve.getTangentAt(t%1).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const offset=getSafeStructureOffset(t,sign,.10,length/2,2.2);
    const center=p.clone().add(side.multiplyScalar(sign*offset));

    const railMat=new THREE.MeshStandardMaterial({color:0x9fa4aa,metalness:.72,roughness:.34});
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.16,1.0,length),railMat);
    rail.position.set(center.x,.72,center.z);
    rail.rotation.y=Math.atan2(-tangent.x,-tangent.z);
    rail.castShadow=true;
    scene.add(rail);

    for(const q of [-length/2,0,length/2]){
        const post= new THREE.Mesh(new THREE.BoxGeometry(.12,1.45,.12),railMat);
        const pos=center.clone().add(tangent.clone().multiplyScalar(q));
        post.position.set(pos.x,.62,pos.z);
        post.castShadow=true;
        scene.add(post);
    }
}

// 코너 외측과 직선 구간을 중심으로 방호벽을 배치한다.
// 방호벽은 급커브에서 footprint가 도로로 침범할 가능성이 있어 생성하지 않는다.
// 도로 바깥 물체가 도로 위에 겹치지 않는 것을 우선한다.

function addTireBarrier(t, sign){
    const p=trackCurve.getPointAt(t%1);
    const tangent=trackCurve.getTangentAt(t%1).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const baseOffset=getSafeStructureOffset(t,sign,1.55,.30,2.0);
    const center=p.clone().add(side.multiplyScalar(sign*baseOffset));
    const tireMat=new THREE.MeshStandardMaterial({color:0x111111,roughness:.95});

    for(let j=-2;j<=2;j++){
        const tire=new THREE.Mesh(new THREE.TorusGeometry(.48,.18,8,14),tireMat);
        const pos=center.clone().add(tangent.clone().multiplyScalar(j*.62));
        tire.position.set(pos.x,.43,pos.z);
        tire.rotation.x=Math.PI/2;
        tire.rotation.y=Math.atan2(-tangent.x,-tangent.z);
        tire.castShadow=true;
        scene.add(tire);
    }
}

// 타이어 배리어는 트랙 형상 변경 시 도로와 겹칠 수 있어 생성을 비활성화한다.

function addGrandstand(t, sign, length=32){
    const p=trackCurve.getPointAt(t%1);
    const tangent=trackCurve.getTangentAt(t%1).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const offset=getSafeStructureOffset(t,sign,3.75,length/2,4.0);
    const center=p.clone().add(side.multiplyScalar(sign*offset));
    const group=new THREE.Group();

    const base=new THREE.Mesh(
        new THREE.BoxGeometry(length,2.8,7.5),
        new THREE.MeshStandardMaterial({color:0x6f747a,roughness:.85})
    );
    base.position.set(center.x,1.4,center.z);
    base.rotation.y=Math.atan2(-tangent.x,-tangent.z);
    base.castShadow=true;
    group.add(base);

    const roof=new THREE.Mesh(
        new THREE.BoxGeometry(length+1.5,.35,8.2),
        new THREE.MeshStandardMaterial({color:0x25282c,roughness:.7,metalness:.15})
    );
    roof.position.set(center.x,3.5,center.z);
    roof.rotation.y=base.rotation.y;
    roof.castShadow=true;
    group.add(roof);

    const seatsMat=new THREE.MeshStandardMaterial({color:0xb83a35,roughness:.9});
    for(let row=0;row<3;row++){
        const seats=new THREE.Mesh(new THREE.BoxGeometry(length-2,.28,1.45),seatsMat);
        const localZ=sign*(2.3-row*1.05);
        const pos=center.clone().add(side.clone().multiplyScalar(localZ));
        pos.y=2.25+row*.34;
        seats.position.copy(pos);
        seats.rotation.y=base.rotation.y;
        group.add(seats);
    }

    scene.add(group);
}

// 그랜드스탠드는 트랙의 실제 곡률/footprint와 충돌하지 않도록 이번 버전에서는 생성하지 않는다.

function addPitBuilding(t, sign){
    const p=trackCurve.getPointAt(t%1);
    const tangent=trackCurve.getTangentAt(t%1).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const offset=getSafeStructureOffset(t,sign,4.0,18.0,4.0);
    const center=p.clone().add(side.multiplyScalar(sign*offset));
    const group=new THREE.Group();
    const building=new THREE.Mesh(
        new THREE.BoxGeometry(36,4.5,8),
        new THREE.MeshStandardMaterial({color:0xe1e1df,roughness:.78})
    );
    building.position.set(center.x,2.25,center.z);
    building.rotation.y=Math.atan2(-tangent.x,-tangent.z);
    building.castShadow=true;
    group.add(building);

    const roof=new THREE.Mesh(
        new THREE.BoxGeometry(37,.35,8.5),
        new THREE.MeshStandardMaterial({color:0x22262b,roughness:.65})
    );
    roof.position.set(center.x,4.65,center.z);
    roof.rotation.y=building.rotation.y;
    group.add(roof);

    for(let i=0;i<7;i++){
        const window=new THREE.Mesh(
            new THREE.BoxGeometry(3,.9,.08),
            new THREE.MeshStandardMaterial({color:0x1c2932,metalness:.2,roughness:.2})
        );
        const localX=-15+i*5;
        const pos=center.clone().add(tangent.clone().multiplyScalar(localX));
        pos.add(side.clone().multiplyScalar(-sign*4.03));
        pos.y=2.8;
        window.position.copy(pos);
        window.rotation.y=building.rotation.y;
        group.add(window);
    }
    scene.add(group);
}

// 스타트/피니시 직선 주변에 피트 건물을 구성한다.
// 피트 건물은 새 트랙 형상에서 도로 침범을 방지하기 위해 생성하지 않는다.

function addStartFinishLine(){
    const t=0;
    const p=trackCurve.getPointAt(t);
    const tangent=trackCurve.getTangentAt(t).normalize();
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const line=new THREE.Mesh(
        new THREE.BoxGeometry(roadWidth,.025,.8),
        new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8})
    );
    line.position.set(p.x,.045,p.z);
    line.rotation.y=Math.atan2(-tangent.x,-tangent.z);
    scene.add(line);

    // 도로 위를 가로지르는 폴/배너는 생성하지 않는다.
}

addStartFinishLine();


/* =========================================================
   TREES
========================================================= */

function createTrees(){
    let placed=0;
    // 줄기와 수관이 도로에 닿지 않도록 각 후보 위치의 최단거리를 검사한다.
    for(let i=0;i<360 && placed<90;i++){
        const t=(i/360+.003)%1;
        const p=trackCurve.getPointAt(t);
        const tangent=trackCurve.getTangentAt(t).normalize();
        const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
        const sign=i%2===0?1:-1;
        const distance=roadWidth/2+8+((i*17)%31);
        const pos=p.clone().add(side.multiplyScalar(distance*sign));
        if(nearestTrackDistance(pos.x,pos.z)<roadWidth/2+6) continue;
        const trunk=new THREE.Mesh(
            new THREE.CylinderGeometry(.22,.32,4,7),
            new THREE.MeshStandardMaterial({color:0x493020,roughness:1})
        );
        trunk.position.set(pos.x,2,pos.z);
        const crown=new THREE.Mesh(
            new THREE.IcosahedronGeometry(2.1,1),
            new THREE.MeshStandardMaterial({color:0x20482a,roughness:1})
        );
        crown.position.set(pos.x,5,pos.z);
        trunk.castShadow=true;
        crown.castShadow=true;
        scene.add(trunk,crown);
        placed++;
    }
}

// 안전거리 검사를 통과한 나무만 트랙 외곽에 생성한다.
createTrees();

/* =========================================================
   MATERIALS
========================================================= */

const red =
    new THREE.MeshStandardMaterial({
        color:0xd71928,
        metalness:.3,
        roughness:.3
    });

const redDark =
    new THREE.MeshStandardMaterial({
        color:0x8d0714,
        metalness:.25,
        roughness:.4
    });

const carbon =
    new THREE.MeshStandardMaterial({
        color:0x101214,
        metalness:.35,
        roughness:.6
    });

const black =
    new THREE.MeshStandardMaterial({
        color:0x050505,
        roughness:.9
    });

const rubber =
    new THREE.MeshStandardMaterial({
        color:0x030303,
        roughness:1
    });

const metal =
    new THREE.MeshStandardMaterial({
        color:0x777777,
        metalness:.8,
        roughness:.25
    });

const yellow =
    new THREE.MeshStandardMaterial({
        color:0xf4c400,
        metalness:.2,
        roughness:.4
    });

const skin =
    new THREE.MeshStandardMaterial({
        color:0xc58d70,
        roughness:.8
    });

const suit =
    new THREE.MeshStandardMaterial({
        color:0x151619,
        roughness:.8
    });


/* =========================================================
   CAR
========================================================= */

const car =
    new THREE.Group();

scene.add(car);

car.position.y=.42;


const bodyGroup =
    new THREE.Group();

const cockpitGroup =
    new THREE.Group();

car.add(bodyGroup);
car.add(cockpitGroup);


/* =========================================================
   HELPERS
========================================================= */

function box(
    w,h,d,
    material,
    x,y,z
){

    const mesh =
        new THREE.Mesh(
            new THREE.BoxGeometry(
                w,h,d
            ),
            material
        );

    mesh.position.set(
        x,y,z
    );

    mesh.castShadow=true;

    return mesh;
}


function cylinder(
    r1,r2,h,
    material,
    x,y,z,
    rotX=0,
    rotY=0,
    rotZ=0,
    segments=16
){

    const mesh =
        new THREE.Mesh(
            new THREE.CylinderGeometry(
                r1,
                r2,
                h,
                segments
            ),
            material
        );

    mesh.position.set(
        x,y,z
    );

    mesh.rotation.set(
        rotX,
        rotY,
        rotZ
    );

    mesh.castShadow=true;

    return mesh;
}


/* =========================================================
   F1 BODY
========================================================= */

const chassis =
    box(
        1.55,
        .42,
        4.25,
        carbon,
        0,
        .57,
        .15
    );

bodyGroup.add(chassis);


const upperBody =
    box(
        1.35,
        .32,
        2.7,
        red,
        0,
        .82,
        .15
    );

bodyGroup.add(upperBody);


/* =========================================================
   NOSE
========================================================= */

const nose =
    new THREE.Mesh(
        new THREE.CylinderGeometry(
            .08,
            .48,
            3.3,
            4
        ),
        red
    );

nose.rotation.x =
    Math.PI/2;

nose.position.set(
    0,
    .58,
    -3.05
);

bodyGroup.add(nose);


const noseTop =
    box(
        .48,
        .20,
        2.0,
        red,
        0,
        .77,
        -2.15
    );

noseTop.rotation.x=-.035;

bodyGroup.add(noseTop);


/* =========================================================
   FRONT WING
========================================================= */

for(
    let i=0;
    i<3;
    i++
){

    const wing =
        box(
            3.5-i*.18,
            .075,
            .28,
            carbon,
            0,
            .28+i*.09,
            -4.25+i*.12
        );

    bodyGroup.add(wing);
}


for(
    const side of [-1,1]
){

    const plate =
        box(
            .10,
            .45,
            .62,
            carbon,
            side*1.75,
            .48,
            -4.12
        );

    bodyGroup.add(plate);
}


/* =========================================================
   SUSPENSION
========================================================= */

function createFrontSuspension(side){

    const geometry =
        new THREE.BufferGeometry()
        .setFromPoints([

            new THREE.Vector3(
                side*.70,
                .66,
                -2.05
            ),

            new THREE.Vector3(
                side*1.17,
                .63,
                -2.25
            )

        ]);

    const arm =
        new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
                color:0x222222
            })
        );

    bodyGroup.add(arm);


    const upper =
        box(
            .07,
            .07,
            1.0,
            carbon,
            side*.95,
            .82,
            -2.1
        );

    upper.rotation.y =
        side*.25;

    bodyGroup.add(upper);
}

createFrontSuspension(-1);
createFrontSuspension(1);


/* =========================================================
   WHEELS
========================================================= */

const wheels=[];

function createWheel(
    side,
    x,
    z,
    radius,
    width
){

    const steering =
        new THREE.Group();

    steering.position.set(
        x,
        radius,
        z
    );

    bodyGroup.add(steering);


    const tire =
        new THREE.Mesh(
            new THREE.CylinderGeometry(
                radius,
                radius,
                width,
                32
            ),
            rubber
        );

    tire.rotation.z=
        Math.PI/2;

    steering.add(tire);


    const rim =
        new THREE.Mesh(
            new THREE.CylinderGeometry(
                radius*.57,
                radius*.57,
                width+.01,
                20
            ),
            metal
        );

    rim.rotation.z=
        Math.PI/2;

    steering.add(rim);


    const disc =
        new THREE.Mesh(
            new THREE.CylinderGeometry(
                radius*.42,
                radius*.42,
                .045,
                24
            ),
            metal
        );

    disc.rotation.z=
        Math.PI/2;

    disc.position.x =
        side*(width/2+.025);

    steering.add(disc);


    const stripe =
        new THREE.Mesh(
            new THREE.TorusGeometry(
                radius*.91,
                .025,
                6,
                32
            ),
            yellow
        );

    stripe.rotation.y=
        Math.PI/2;

    stripe.position.x =
        side*(width/2+.04);

    steering.add(stripe);


    wheels.push({
        group:steering,
        tire:tire,
        radius:radius
    });
}


createWheel(
    -1,-1.15,-2.05,.48,.38
);

createWheel(
    1,1.15,-2.05,.48,.38
);

createWheel(
    -1,-1.23,1.70,.58,.48
);

createWheel(
    1,1.23,1.70,.58,.48
);


/* =========================================================
   SIDE PODS
========================================================= */

for(
    const side of [-1,1]
){

    const pod =
        box(
            .68,
            .62,
            1.95,
            red,
            side*1.05,
            .68,
            .48
        );

    bodyGroup.add(pod);


    const inlet =
        box(
            .08,
            .30,
            .95,
            black,
            side*1.405,
            .77,
            .20
        );

    bodyGroup.add(inlet);


    const floor =
        box(
            .88,
            .10,
            2.4,
            carbon,
            side*.72,
            .34,
            .48
        );

    bodyGroup.add(floor);
}


/* =========================================================
   ENGINE COVER
========================================================= */

const engineCover =
    new THREE.Mesh(
        new THREE.CylinderGeometry(
            .42,
            .72,
            2.25,
            8
        ),
        red
    );

engineCover.rotation.x=
    Math.PI/2;

engineCover.position.set(
    0,
    .92,
    1.0
);

bodyGroup.add(engineCover);


/* =========================================================
   AIRBOX
========================================================= */

const airbox =
    new THREE.Mesh(
        new THREE.CylinderGeometry(
            .30,
            .38,
            .62,
            8
        ),
        black
    );

airbox.rotation.x=
    Math.PI/2;

airbox.position.set(
    0,
    1.28,
    .62
);

bodyGroup.add(airbox);


const airboxTop =
    box(
        .50,
        .12,
        .34,
        red,
        0,
        1.53,
        .62
    );

bodyGroup.add(airboxTop);


/* =========================================================
   REAR
========================================================= */

const rearBody =
    box(
        1.8,
        .45,
        1.35,
        red,
        0,
        .78,
        2.0
    );

bodyGroup.add(rearBody);


const diffuser =
    box(
        2.8,
        .14,
        .65,
        carbon,
        0,
        .29,
        2.55
    );

bodyGroup.add(diffuser);


for(
    const side of [-1,1]
){

    const support =
        box(
            .10,
            1.15,
            .12,
            carbon,
            side*.58,
            1.15,
            2.20
        );

    bodyGroup.add(support);
}


const rearWingLower =
    box(
        3.15,
        .13,
        .38,
        carbon,
        0,
        1.52,
        2.22
    );

bodyGroup.add(rearWingLower);


const rearWingUpper =
    box(
        2.95,
        .15,
        .42,
        redDark,
        0,
        2.08,
        2.20
    );

bodyGroup.add(rearWingUpper);


for(
    const side of [-1,1]
){

    const plate =
        box(
            .10,
            .80,
            .45,
            carbon,
            side*1.48,
            1.80,
            2.20
        );

    bodyGroup.add(plate);
}


const exhaust =
    cylinder(
        .12,.16,.42,
        metal,
        0,.85,2.73,
        Math.PI/2,
        0,0,16
    );

bodyGroup.add(exhaust);


/* =========================================================
   COCKPIT
========================================================= */

const cockpitFloor =
    box(
        1.35,
        .12,
        2.05,
        carbon,
        0,
        .39,
        -.05
    );

cockpitGroup.add(cockpitFloor);


const cockpitLeft =
    box(
        .28,
        .62,
        2.15,
        red,
        -.80,
        .68,
        -.05
    );

const cockpitRight =
    box(
        .28,
        .62,
        2.15,
        red,
        .80,
        .68,
        -.05
    );

cockpitGroup.add(
    cockpitLeft,
    cockpitRight
);


const cockpitFront =
    box(
        1.50,
        .18,
        .30,
        carbon,
        0,
        .93,
        -.95
    );

cockpitGroup.add(cockpitFront);


/* =========================================================
   DASHBOARD
========================================================= */

const dashboard =
    box(
        1.15,
        .18,
        .48,
        black,
        0,
        1.02,
        -.58
    );

dashboard.rotation.x=-.20;

cockpitGroup.add(dashboard);


/* =========================================================
   STEERING WHEEL
========================================================= */

const steeringGroup =
    new THREE.Group();

steeringGroup.position.set(
    0,
    1.02,
    -.30
);

cockpitGroup.add(
    steeringGroup
);


const steeringRing =
    new THREE.Mesh(
        new THREE.TorusGeometry(
            .34,.065,12,32
        ),
        black
    );

steeringRing.rotation.x=
    Math.PI/2;

steeringGroup.add(
    steeringRing
);


const steeringCenter =
    box(
        .48,.14,.12,
        carbon,
        0,0,-.02
    );

steeringGroup.add(
    steeringCenter
);


for(
    let i=0;
    i<3;
    i++
){

    const spoke =
        box(
            .055,.055,.32,
            carbon,
            0,0,-.01
        );

    spoke.rotation.y =
        i*Math.PI*2/3;

    steeringGroup.add(spoke);
}


/* =========================================================
   STEERING COLUMN
========================================================= */

const steeringColumn =
    cylinder(
        .06,.08,.60,
        black,
        0,.86,-.03,
        Math.PI/2,
        0,0,12
    );

cockpitGroup.add(
    steeringColumn
);


/* =========================================================
   DRIVER ARMS
========================================================= */

function createArm(side){

    const group =
        new THREE.Group();


    const upper =
        cylinder(
            .11,.13,.62,
            suit,
            side*.34,
            .67,
            -.03,
            0,0,
            side*.45,
            10
        );

    group.add(upper);


    const fore =
        cylinder(
            .085,.11,.55,
            suit,
            side*.22,
            .87,
            -.22,
            0,0,
            side*.25,
            10
        );

    group.add(fore);


    const hand =
        new THREE.Mesh(
            new THREE.SphereGeometry(
                .125,12,8
            ),
            skin
        );

    hand.position.set(
        side*.30,
        .99,
        -.37
    );

    hand.scale.set(
        .8,1,1.25
    );

    group.add(hand);

    cockpitGroup.add(group);

    return group;
}


const leftArm =
    createArm(-1);

const rightArm =
    createArm(1);


/* =========================================================
   HALO
========================================================= */

const halo =
    new THREE.Group();

cockpitGroup.add(halo);


const haloPillar =
    cylinder(
        .055,.065,1.15,
        black,
        0,1.50,-.20,
        0,0,0,10
    );

halo.add(haloPillar);


const haloRing =
    new THREE.Mesh(
        new THREE.TorusGeometry(
            .65,.055,8,28,Math.PI
        ),
        black
    );

haloRing.rotation.x=
    Math.PI/2;

haloRing.position.set(
    0,1.67,-.20
);

halo.add(haloRing);


/* =========================================================
   REALISTIC VEHICLE PHYSICS
========================================================= */

/*
    차량 물리 파라미터

    단위:
    mass      = kg
    speed     = m/s
    force     = N
    torque    = Nm
*/

const physics = {

    /* --------------------------
       vehicle
    -------------------------- */

    mass:798,

    wheelRadius:.33,

    wheelBase:3.2,

    trackWidth:1.55,


    /* --------------------------
       engine
    -------------------------- */

    engineMaxRPM:15000,

    idleRPM:5000,

    engineRPM:5000,

    engineTorque:0,


    /* --------------------------
       transmission
    -------------------------- */

    gears:[
        3.20,
        2.65,
        2.15,
        1.78,
        1.50,
        1.28,
        1.08,
        .92
    ],

    finalDrive:3.10,

    gear:0,

    shiftUpRPM:13800,

    shiftDownRPM:8500,

    shiftTimer:0,

    shiftDelay:.12,


    /* --------------------------
       speed
    -------------------------- */

    speed:0,

    maxSpeed:95,


    /* --------------------------
       steering
    -------------------------- */

    steering:0,

    steeringTarget:0,

    yaw:0,


    /* --------------------------
       braking
    -------------------------- */

    brakeForce:16000,


    /* --------------------------
       aerodynamic
    -------------------------- */

    rho:1.225,

    Cd:.72,

    frontalArea:1.5,

    downforceCoefficient:4.0,


    /* --------------------------
       rolling resistance
    -------------------------- */

    rollingCoefficient:.012,


    /* --------------------------
       surface
    -------------------------- */

    surface:"asphalt",

    grip:1,

    rolling:1,

    surfaceDriveMultiplier:1,
    surfaceBrakeMultiplier:1,
    surfaceExtraDrag:0,
    surfaceMaxSpeed:95,
    reverseRatio:2.80,
    reverseMaxSpeed:8.0,
    reverse:false,
    smoothSurfaceLimit:95,

    brakePressure:0,


    /* --------------------------
       telemetry
    -------------------------- */

    driveForce:0,

    dragForce:0,

    rollingForce:0,

    brakeForceActual:0,

    acceleration:0
};


/* =========================================================
   ENGINE TORQUE CURVE
========================================================= */

function getEngineTorque(rpm){

    /*
        단순한 고성능 레이싱 엔진 토크 곡선

        낮은 RPM:
        토크 증가

        중간 RPM:
        최대 토크

        고RPM:
        점차 감소
    */

    const points = [

        [5000,430],
        [6500,500],
        [8000,560],
        [9500,575],
        [11000,565],
        [12500,535],
        [13800,490],
        [15000,420]

    ];


    if(rpm<=points[0][0])
        return points[0][1];

    if(rpm>=points[points.length-1][0])
        return points[points.length-1][1];


    for(
        let i=0;
        i<points.length-1;
        i++
    ){

        const a=points[i];
        const b=points[i+1];

        if(
            rpm>=a[0] &&
            rpm<=b[0]
        ){

            const ratio =
                (rpm-a[0])/
                (b[0]-a[0]);

            return THREE.MathUtils.lerp(
                a[1],
                b[1],
                ratio
            );
        }
    }

    return 500;
}


/* =========================================================
   SURFACE DETECTION
========================================================= */

function getSurface(){
    // 실제 도로 메시와 동일한 700개 중심선 샘플을 사용한다.
    // 기존 80개 샘플에서 생기던 경계 오판정을 제거한다.
    const closestDistance=nearestTrackDistanceFast(car.position.x,car.position.z);
    return closestDistance <= roadWidth/2 ? "asphalt" : "grass";
}

/* =========================================================
   SURFACE PHYSICS
========================================================= */

function updateSurface(){

    const surface=getSurface();
    physics.surface=surface;

    if(surface==="asphalt"){
        physics.grip=1.00;
        physics.rolling=1.00;
        physics.surfaceDriveMultiplier=1.00;
        physics.surfaceBrakeMultiplier=1.00;
        physics.surfaceExtraDrag=0;
        physics.surfaceMaxSpeed=physics.maxSpeed;
    }else{
        /*
           잔디는 202 km/h 부근까지 갈 수 있지만 즉시 속도를 잘라내지 않는다.
           목표 속도는 197~207 km/h 범위 안에서 약 202 km/h로 두고,
           실제 감속은 추가 저항으로 부드럽게 만든다.
        */
        physics.grip=.38;
        physics.rolling=4.5;
        physics.surfaceDriveMultiplier=.68;
        physics.surfaceBrakeMultiplier=.66;
        physics.surfaceExtraDrag=260;
        physics.surfaceMaxSpeed=56.1; // 약 202 km/h
    }

    // 노면이 바뀔 때 목표 제한속도도 즉시 잘라내지 않고 따라가게 한다.
    const target=physics.surfaceMaxSpeed;
    const response=physics.surface==="grass" ? 1.15 : 2.5;
    physics.smoothSurfaceLimit += (target-physics.smoothSurfaceLimit)*Math.min(1,response/60);

    document.getElementById("surface").textContent=
        surface==="asphalt" ? "DRY ASPHALT" : "GRASS";
}


/* =========================================================
   AERODYNAMICS
========================================================= */

function calculateAero(){

    const v =
        Math.abs(physics.speed);


    /*
       공기저항

       Fd = 1/2 rho Cd A v²
    */

    physics.dragForce =
        .5 *
        physics.rho *
        physics.Cd *
        physics.frontalArea *
        v*v;


    /*
       다운포스

       고속에서 타이어를
       노면으로 누르는 힘 증가
    */

    const downforce =
        physics.downforceCoefficient *
        v*v;


    return downforce;
}


/* =========================================================
   ENGINE RPM
========================================================= */

function updateEngineRPM(){
    if(physics.reverse){
        const wheelRPM=(Math.abs(physics.speed)/(2*Math.PI*physics.wheelRadius))*60;
        const targetRPM=wheelRPM*physics.reverseRatio*physics.finalDrive;
        physics.engineRPM=THREE.MathUtils.lerp(
            physics.engineRPM,
            Math.max(physics.idleRPM,targetRPM),
            .18
        );
        physics.engineRPM=THREE.MathUtils.clamp(
            physics.engineRPM,physics.idleRPM,physics.engineMaxRPM
        );
        return;
    }

    if(physics.gear<=0){
        physics.engineRPM=THREE.MathUtils.lerp(physics.engineRPM,physics.idleRPM,.08);
        return;
    }

    const wheelRPM=(Math.abs(physics.speed)/(2*Math.PI*physics.wheelRadius))*60;
    const targetRPM=wheelRPM*physics.gears[physics.gear]*physics.finalDrive;
    physics.engineRPM=THREE.MathUtils.lerp(
        physics.engineRPM,
        Math.max(physics.idleRPM,targetRPM),
        .25
    );

    if(physics.engineRPM>physics.shiftUpRPM && physics.gear<physics.gears.length-1){
        physics.gear++;
        physics.shiftTimer=physics.shiftDelay;
    }
    if(physics.engineRPM<physics.shiftDownRPM && physics.gear>1){
        physics.gear--;
        physics.shiftTimer=physics.shiftDelay;
    }

    physics.engineRPM=THREE.MathUtils.clamp(
        physics.engineRPM,physics.idleRPM,physics.engineMaxRPM
    );
}


function calculateDriveForce(throttle,downforce){

    if(!throttle){
        physics.driveForce=0;
        return 0;
    }

    const torque=getEngineTorque(physics.engineRPM);
    physics.engineTorque=torque;
    const normalForce=physics.mass*9.81+downforce;
    const tractionLimit=physics.grip*normalForce;

    if(physics.reverse){
        const wheelTorque=torque*physics.reverseRatio*physics.finalDrive;
        const engineForce=wheelTorque/physics.wheelRadius;
        const actualForce=Math.min(engineForce,tractionLimit)*physics.surfaceDriveMultiplier;
        physics.driveForce=actualForce;
        return -actualForce;
    }

    if(physics.gear<1){
        physics.driveForce=0;
        return 0;
    }

    const wheelTorque=torque*physics.gears[physics.gear]*physics.finalDrive;
    const engineForce=wheelTorque/physics.wheelRadius;
    const actualForce=Math.min(engineForce,tractionLimit)*physics.surfaceDriveMultiplier;
    physics.driveForce=actualForce;
    return actualForce;
}


/* =========================================================
   BRAKING
========================================================= */

function calculateBrakeForce(brake,downforce,dt){

    // 브레이크 페달 입력도 즉시 0→100%가 되지 않도록 압력을 램프한다.
    const target=brake?1:0;
    const rate=target>physics.brakePressure?8.5:11.0;
    physics.brakePressure += (target-physics.brakePressure)*Math.min(1,rate*dt);

    if(physics.brakePressure<.001){
        physics.brakeForceActual=0;
        return 0;
    }

    const normalForce=physics.mass*9.81+downforce;
    const tireLimit=physics.grip*physics.surfaceBrakeMultiplier*normalForce;

    // 고속에서는 다운포스로 더 큰 제동력을 노면에 전달할 수 있지만,
    // 저속에서는 타이어 마찰 한계를 넘지 않는다.
    const availableBrake=Math.min(physics.brakeForce,tireLimit);
    const brakeForce=availableBrake*physics.brakePressure;

    physics.brakeForceActual=brakeForce;
    return brakeForce;
}


/* =========================================================
   ROLLING RESISTANCE
========================================================= */

function calculateRollingResistance(){
    const normalForce=physics.mass*9.81;
    const magnitude=physics.rollingCoefficient*physics.rolling*normalForce;
    if(Math.abs(physics.speed)<0.02) return 0;
    return Math.sign(physics.speed)*magnitude;
}


/* =========================================================
   CAR UPDATE
========================================================= */

function updateCar(dt){
    const throttle=keys.w||keys.arrowup;
    const brakeInput=keys.s||keys.arrowdown;
    const left=keys.a||keys.arrowleft;
    const right=keys.d||keys.arrowright;

    updateSurface();
    const downforce=calculateAero();

    /* -----------------------------
       FORWARD / REVERSE STATE
       W: forward
       S: forward에서 brake, 완전히 멈춘 뒤 reverse
    ----------------------------- */
    if(throttle){
        if(physics.speed<-.15){
            // 후진 중 W를 누르면 먼저 부드럽게 정지한다.
            physics.reverse=false;
            physics.gear=0;
        }else{
            physics.reverse=false;
            if(physics.gear===0){
                physics.gear=1;
                physics.engineRPM=6000;
            }
        }
    }else if(brakeInput && physics.speed<=.15){
        physics.reverse=true;
        physics.gear=-1;
    }else if(!brakeInput && physics.reverse && Math.abs(physics.speed)<.08){
        physics.reverse=false;
        physics.gear=0;
    }

    updateEngineRPM();

    if(physics.shiftTimer>0) physics.shiftTimer-=dt;

    // 역방향/정방향 전환 시 브레이크와 구동력이 동시에 걸리지 않게 한다.
    const forwardBraking=brakeInput && physics.speed>.08 && !physics.reverse;
    const reverseBraking=throttle && physics.speed<-.08;

    let driveForce=0;
    if(physics.shiftTimer<=0 && !forwardBraking && !reverseBraking){
        driveForce=calculateDriveForce(throttle || (physics.reverse && brakeInput),downforce);
    }

    const brakeForce=calculateBrakeForce(
        forwardBraking || reverseBraking,
        downforce,
        dt
    );

    const rollingForce=calculateRollingResistance();
    const dragForceSigned=Math.sign(physics.speed)*physics.dragForce;

    // 잔디에서는 목표 속도를 넘을수록 추가 저항이 점진적으로 증가한다.
    // 따라서 잔디 진입 순간 속도가 202 km/h로 강제 점프/절삭되지 않는다.
    let surfaceDrag=0;
    if(physics.surface==="grass"){
        const v=Math.abs(physics.speed);
        const softLimit=54.7; // 약 197 km/h
        const excess=Math.max(0,v-softLimit);
        surfaceDrag=physics.surfaceExtraDrag + excess*900;
        surfaceDrag*=Math.sign(physics.speed);
    }

    const netForce=
        driveForce -
        dragForceSigned -
        rollingForce -
        surfaceDrag -
        Math.sign(physics.speed||1)*brakeForce;

    physics.acceleration=netForce/physics.mass;
    physics.speed+=physics.acceleration*dt;

    // 후진은 약 29 km/h까지. 전진은 기존 최고속도를 유지한다.
    if(physics.reverse){
        physics.speed=Math.max(-physics.reverseMaxSpeed,Math.min(0,physics.speed));
    }else{
        // 노면 제한속도는 부드럽게 따라가며 hard clamp는 여유 범위에서만 사용한다.
        const limit=Math.max(physics.smoothSurfaceLimit,physics.surface==="grass"?54.5:physics.maxSpeed);
        physics.speed=Math.min(physics.speed,limit);
        if(physics.speed<0 && !reverseBraking) physics.speed=Math.min(physics.speed+Math.abs(physics.acceleration)*dt,0);
    }

    /* -----------------------------
       STEERING
       저속: 큰 조향 변화
       고속: 같은 A/D 입력 시간에 더 작은 방향 변화
       고속에서 순간적으로 튀는 대신 일정한 yaw rate로 제한
    ----------------------------- */
    const absSpeed=Math.abs(physics.speed);
    const speedRatio=Math.min(1,absSpeed/85);
    const sensitivity=Math.pow(speedRatio,1.65);

    let maxSteering=THREE.MathUtils.lerp(.78,.045,sensitivity);
    let steeringResponse=THREE.MathUtils.lerp(8.5,2.8,speedRatio);

    if(physics.surface==="grass"){
        maxSteering*=.84;
        steeringResponse*=.90;
    }

    const input=(left?1:0)-(right?1:0);
    physics.steeringTarget=input*maxSteering;
    physics.steering+=(physics.steeringTarget-physics.steering)*Math.min(1,steeringResponse*dt);

    if(absSpeed>.05){
        let yawRate=(absSpeed/physics.wheelBase)*Math.tan(physics.steering);
        yawRate*=physics.grip;

        // 고속으로 갈수록 A/D 한 번의 지속 입력이 만드는 방향 변화량을 강하게 축소한다.
        const highSpeedFactor=THREE.MathUtils.lerp(1,.30,Math.pow(speedRatio,1.7));
        yawRate*=highSpeedFactor;
        if(physics.surface==="grass") yawRate*=.84;

        const maxYawRate=THREE.MathUtils.lerp(1.90,.22,Math.pow(speedRatio,1.6));
        yawRate=THREE.MathUtils.clamp(yawRate,-maxYawRate,maxYawRate);

        // 후진 시 조향 방향은 실제 차량과 동일하게 반전된다.
        if(physics.reverse) yawRate=-yawRate;
        physics.yaw+=yawRate*dt;
        car.rotation.y=physics.yaw;
    }

    // 이동은 조향과 독립적으로 실행한다.
    if(Math.abs(physics.speed)>0.001){
        const forward=new THREE.Vector3(0,0,-1);
        forward.applyQuaternion(car.quaternion);
        forward.y=0;
        if(forward.lengthSq()>0.000001){
            forward.normalize();
            car.position.addScaledVector(forward,physics.speed*dt);
        }
    }

    wheels[0].group.rotation.y=physics.steering;
    wheels[1].group.rotation.y=physics.steering;
    for(const wheel of wheels){
        wheel.tire.rotation.x+=(physics.speed/wheel.radius)*dt;
    }

    const wheelAngle=physics.steering*2.2;
    steeringGroup.rotation.z=-wheelAngle;
    leftArm.rotation.z=-wheelAngle*.22;
    rightArm.rotation.z=-wheelAngle*.22;
    updateHUD();
    // 미니맵은 10 FPS로 갱신해 매 프레임의 Canvas 작업을 줄인다.
    if(performance.now()-lastMinimapDraw >= 100){
        drawMinimap();
        lastMinimapDraw=performance.now();
    }
}


const keys={};

window.addEventListener("keydown",e=>{
    const key=e.key.toLowerCase();
    keys[key]=true;
    if(e.code==="KeyW") keys.w=true;
    if(e.code==="KeyS") keys.s=true;
    if(e.code==="KeyA") keys.a=true;
    if(e.code==="KeyD") keys.d=true;
    if(e.code==="ArrowUp") keys.arrowup=true;
    if(e.code==="ArrowDown") keys.arrowdown=true;
    if(e.code==="ArrowLeft") keys.arrowleft=true;
    if(e.code==="ArrowRight") keys.arrowright=true;
    if(key==="v") firstPerson=!firstPerson;
    if(key==="r") resetCar();
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
});

window.addEventListener("keyup",e=>{
    const key=e.key.toLowerCase();
    keys[key]=false;
    if(e.code==="KeyW") keys.w=false;
    if(e.code==="KeyS") keys.s=false;
    if(e.code==="KeyA") keys.a=false;
    if(e.code==="KeyD") keys.d=false;
    if(e.code==="ArrowUp") keys.arrowup=false;
    if(e.code==="ArrowDown") keys.arrowdown=false;
    if(e.code==="ArrowLeft") keys.arrowleft=false;
    if(e.code==="ArrowRight") keys.arrowright=false;
});


/* =========================================================
   CAMERA
========================================================= */

let firstPerson=true;


/* =========================================================
   MINIMAP
========================================================= */
const minimapCanvas=document.getElementById("minimap");
const minimapCtx=minimapCanvas.getContext("2d", {alpha:false});
let lastMinimapDraw=0;

const mapBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
for(const p of trackSamples){
    mapBounds.minX=Math.min(mapBounds.minX,p.x);
    mapBounds.maxX=Math.max(mapBounds.maxX,p.x);
    mapBounds.minZ=Math.min(mapBounds.minZ,p.z);
    mapBounds.maxZ=Math.max(mapBounds.maxZ,p.z);
}
const mapPadding=22;
const mapScale=Math.min(
    (minimapCanvas.width-mapPadding*2)/(mapBounds.maxX-mapBounds.minX),
    (minimapCanvas.height-mapPadding*2)/(mapBounds.maxZ-mapBounds.minZ)
);

function mapPoint(x,z){
    return {
        x:(x-mapBounds.minX)*mapScale+mapPadding,
        y:(mapBounds.maxZ-z)*mapScale+mapPadding
    };
}

function drawMinimap(){
    const ctx=minimapCtx;
    const w=minimapCanvas.width,h=minimapCanvas.height;
    ctx.clearRect(0,0,w,h);

    ctx.fillStyle="#304631";
    ctx.fillRect(0,0,w,h);

    // 검은색 도로를 실제 트랙 중심선과 동일한 경로로 그린다.
    ctx.beginPath();
    trackSamples.forEach((p,i)=>{
        const q=mapPoint(p.x,p.z);
        if(i===0) ctx.moveTo(q.x,q.y);
        else ctx.lineTo(q.x,q.y);
    });
    ctx.closePath();
    ctx.lineWidth=Math.max(5,roadWidth*mapScale);
    ctx.lineCap="round";
    ctx.lineJoin="round";
    ctx.strokeStyle="#070809";
    ctx.stroke();

    // 도로 경계선을 표시한다.
    ctx.lineWidth=1;
    ctx.strokeStyle="rgba(255,255,255,.75)";
    ctx.stroke();

    const carPos=mapPoint(car.position.x,car.position.z);
    ctx.save();
    ctx.translate(carPos.x,carPos.y);
    // Canvas는 Z축을 화면의 아래쪽으로 뒤집어 표시하므로 차량 yaw도 반전한다.
    ctx.rotate(-car.rotation.y);
    ctx.beginPath();
    ctx.moveTo(0,-7);
    ctx.lineTo(4,6);
    ctx.lineTo(0,4);
    ctx.lineTo(-4,6);
    ctx.closePath();
    ctx.fillStyle="#e51b23";
    ctx.fill();
    ctx.restore();
}


function updateCamera(){

    if(firstPerson){

        /*
           차량 로컬 좌표에 고정.

           속도에 따른 camera offset 없음.
        */

        const cameraPosition =
            car.localToWorld(
                new THREE.Vector3(
                    0,
                    1.43,
                    -.55
                )
            );


        camera.position.copy(
            cameraPosition
        );


        const lookPosition =
            car.localToWorld(
                new THREE.Vector3(
                    0,
                    1.38,
                    -70
                )
            );


        camera.lookAt(
            lookPosition
        );


        document.getElementById(
            "cameraMode"
        ).textContent=
            "ONBOARD";
    }

    else{

        const target =
            car.localToWorld(
                new THREE.Vector3(
                    0,
                    3.4,
                    9.5
                )
            );


        camera.position.lerp(
            target,
            .12
        );


        const look =
            car.localToWorld(
                new THREE.Vector3(
                    0,
                    .7,
                    0
                )
            );


        camera.lookAt(
            look
        );


        document.getElementById(
            "cameraMode"
        ).textContent=
            "CHASE";
    }
}


/* =========================================================
   HUD
========================================================= */

function updateHUD(){

    const kmh =
        Math.round(
            physics.speed*3.6
        );


    document.getElementById(
        "speed"
    ).textContent=
        kmh;


    let gear="N";


    if(
        physics.gear>0
    ){

        gear =
            String(
                physics.gear
            );
    }


    document.getElementById(
        "gear"
    ).textContent=
        gear;


    /*
       RPM 게이지
    */

    const rpmRatio =
        THREE.MathUtils.clamp(
            (
                physics.engineRPM-
                physics.idleRPM
            )/
            (
                physics.engineMaxRPM-
                physics.idleRPM
            ),
            0,
            1
        );


    document.getElementById(
        "rpmFill"
    ).style.width=
        (
            rpmRatio*100
        )+"%";
}


/* =========================================================
   RESET
========================================================= */

function resetCar(){

    const point =
        trackCurve.getPointAt(0);

    const tangent =
        trackCurve
        .getTangentAt(0)
        .normalize();


    car.position.copy(point);

    car.position.y=.42;


    /*
       local -Z = forward
    */

    car.rotation.y =
        Math.atan2(
            -tangent.x,
            -tangent.z
        );


    physics.yaw =
        car.rotation.y;


    physics.speed=0;

    physics.gear=0;

    physics.engineRPM=
        physics.idleRPM;

    physics.steering=0;

    physics.steeringTarget=0;
    physics.brakePressure=0;
    physics.reverse=false;
    physics.smoothSurfaceLimit=physics.maxSpeed;
    physics.surfaceMaxSpeed=physics.maxSpeed;
}


/* =========================================================
   RESIZE
========================================================= */

window.addEventListener(
    "resize",
    () => {

        camera.aspect =
            innerWidth/
            innerHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
            innerWidth,
            innerHeight
        );
    }
);


/* =========================================================
   START
========================================================= */

let running=false;

let lastTime=
    performance.now();


document.getElementById(
    "startBtn"
).onclick=()=>{

    document.getElementById(
        "start"
    ).style.display="none";

    running=true;

    lastTime=
        performance.now();

    requestAnimationFrame(
        animate
    );
};


/* =========================================================
   GAME LOOP
========================================================= */

function animate(time){

    if(!running)
        return;


    const dt=
        Math.min(
            .033,
            (time-lastTime)/1000
        );


    lastTime=time;


    updateCar(dt);

    updateCamera();


    renderer.render(
        scene,
        camera
    );


    requestAnimationFrame(
        animate
    );
}


/* =========================================================
   INITIAL
========================================================= */

resetCar();

drawMinimap();
lastMinimapDraw=performance.now();
updateCamera();

renderer.render(
    scene,
    camera
);
