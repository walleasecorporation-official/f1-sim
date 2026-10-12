# F1 Racing Simulator

Three.js로 만든 브라우저 F1 시뮬레이터입니다. 빌드 과정 없이 `index.html`을 열면 실행됩니다.

## 실행

```bash
# 아무 정적 서버나 사용 가능
npx http-server -p 8080 .
# 또는
python3 -m http.server 8080
```

- PC: `index.html`을 바로 열어도 동작합니다. three.js는 `js/vendor`에 포함되어 있어 오프라인에서도 실행됩니다.
- 모바일 기울기 조향은 **HTTPS 주소**(예: GitHub Pages)에서만 동작합니다. 브라우저가 HTTP에서는 센서를 막기 때문입니다. 센서를 쓸 수 없으면 좌/우 터치 버튼으로 자동 전환됩니다.

### URL 옵션
| 옵션 | 설명 |
|------|------|
| `?quality=low\|medium\|high` | 그래픽 품질 강제 (기본: PC `high`, 모바일 `medium`) |
| `?mobile=1` / `?mobile=0` | 모바일 UI 강제 켜기/끄기 |
| `?fps` | FPS와 현재 렌더 해상도 배율 표시 |

## 조작

| PC | 모바일 |
|----|--------|
| `W` 가속 | 오른쪽 **THROTTLE** 페달 |
| `S` 브레이크 / 정지 후 후진 | 왼쪽 **BRAKE** 페달 |
| `A` `D` 조향 | 폰을 **핸들처럼 기울이기** |
| `V` 카메라 전환 (CHASE / ONBOARD / T-CAM) | `CAM` 버튼 |
| `R` 가장 가까운 트랙으로 복귀 | `↺` 버튼 |
| `P` / `Esc` 일시정지 | `❚❚` 버튼 |
| — | `◎` 현재 자세를 기울기 영점으로 |

## 구조

```
index.html
css/style.css
js/
  config.js       기기 판별, 그래픽 품질 프리셋
  utils.js        난수, Canvas 텍스처, 지오메트리 병합, Loft(곡면) 생성
  track.js        영암 서킷 레이아웃(코너 시퀀스), 샘플, 공간 격자 판정
  core.js         renderer / scene / camera
  environment.js  하늘, 조명, 도로, 연석, 방호벽, 피트, 관중석, 나무, 호수, 산
  car.js          2026 규정 비율 F1 차량 모델
  physics.js      차량 물리 (기존 모델 유지) + 방호벽 충돌
  input.js        키보드 / 터치 페달 / 기울기 조향
  hud.js          HUD, 미니맵, 랩 타이밍
  main.js         카메라, 게임 루프, 화면 흐름, 적응형 해상도
  vendor/three.min.js (r160)
docs/PHYSICS_PROPOSAL.md  실제 F1 물리 적용 제안서 (승인 대기)
```

## 모바일 최적화
- 정적 차체를 재질별로 병합하고 나무를 InstancedMesh로 그려 draw call을 줄였습니다(약 70개 안팎).
- FPS에 따라 렌더 해상도를 자동으로 조절합니다(적응형 pixel ratio).
- 모든 텍스처는 Canvas로 생성해 다운로드할 이미지가 없습니다.
- 그림자맵은 `high`에서만 켜고, 다른 품질에서는 차량 아래 블롭 섀도를 씁니다.
- 주행 중 위치 판정은 직전 위치 주변만 검사하고, DOM은 값이 바뀔 때만 갱신합니다.
- 화면이 꺼지지 않게 Wake Lock을 쓰고, 탭이 백그라운드로 가면 자동으로 일시정지합니다.
