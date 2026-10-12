/* =========================================================
   CORE — renderer / scene / camera
========================================================= */
"use strict";

const canvas = document.getElementById("game");

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: QUALITY.antialias,
    powerPreference: "high-performance",
    stencil: false
});

let currentPixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio);
renderer.setPixelRatio(currentPixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .92;
renderer.shadowMap.enabled = QUALITY.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
QUALITY.anisotropy = Math.min(QUALITY.anisotropy, MAX_ANISOTROPY);

const scene = new THREE.Scene();

const SKY_TOP = new THREE.Color(0x2b64b0);
const SKY_HORIZON = new THREE.Color(0xc4d6e2);
const SKY_GROUND = new THREE.Color(0x8c9a8a);

scene.background = SKY_HORIZON.clone();
scene.fog = new THREE.Fog(SKY_HORIZON, QUALITY.fogNear, QUALITY.fogFar);

const BASE_FOV = 68;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, .12, 4200);

/** 세로 화면(모바일)에서도 좌우 시야가 너무 좁아지지 않게 FOV 보정 */
function fovForAspect(baseFov, aspect){
    if(aspect >= 1.3) return baseFov;
    const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) * 1.3);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hFov / 2) / aspect));
}

const SUN_DIR = new THREE.Vector3(-.42, .62, -.36).normalize();
