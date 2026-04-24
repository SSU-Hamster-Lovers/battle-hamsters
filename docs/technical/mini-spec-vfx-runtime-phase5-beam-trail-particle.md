# Mini-Spec: VFX Runtime Phase 5 — Beam / Trail / Particle Semantics

작업명:
beam / trail / particle semantics 런타임 확장

목표:
`bh-vfx-gen`이 내보내는 `beam`, `trail`, `particle` 계열 semantics를 `battle-hamsters` 런타임이 실제 배치/방향/세그먼트 형태로 해석해, sprite/animation 중심 Phase 4 이후에도 생성 번들을 실사용 가능하게 만든다.

이번 범위:
- `beam` effect가 `segment` 배치와 `along_segment` orientation을 해석하도록 렌더러 확장
- `trail` effect가 `follow` 배치와 `projectile_tail` anchor를 해석하도록 렌더러 확장
- `particle` effect가 `point/follow` 배치와 기본 emission spread를 semantics 기준으로 해석하도록 설계
- 게임 클라이언트가 projectile/beam runtime 데이터와 bundle semantics를 연결하는 호출 계약 정리
- debug overlay를 beam/trail/particle topology까지 확장

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/technical/mini-spec-vfx-runtime-phase4-semantics.md`
- `packages/shared/vfx-bundle.ts`
- `packages/vfx-runtime/renderer.ts`
- `apps/game/src/vfx-bundle-integration.ts`
- `apps/game/src/main.ts`

비목표:
- sprite/animation semantics 재설계
- 생성기(`bh-vfx-gen`)의 semantics authoring 규칙 변경
- 무기별 스타일 밸런싱
- 에셋 퀄리티 개선 자체

검증 방법:
- 타입체크: `@battle-hamsters/vfx-runtime`, `@battle-hamsters/game`
- 게임 빌드 통과
- beam/trail/particle 번들 샘플에 대해 debug overlay로 segment/tail/origin이 기대한 위치에 그려지는지 확인

---

## 설계 메모

- `beam`
  - 기본 topology는 `(start, end)` 세그먼트다.
  - `composition.kind = segment_strip`이면 길이 방향으로 stretch/tile되고, `start/end cap` 유무는 effect 타입 데이터와 semantics를 함께 본다.
  - `semanticAnchor = emission_origin`일 때는 `start`가 발사점, `end`는 조준/충돌점이다.

- `trail`
  - 기본 topology는 움직이는 투사체의 tail-follow다.
  - `semanticAnchor = projectile_tail`이면 effect 좌표는 projectile 중심이 아니라 tail 기준 보정이 필요하다.
  - `composition.kind = trail_strip`은 진행 방향 반대쪽으로 content가 남아야 하므로, sprite flip 수준이 아니라 velocity 기반 orientation이 필요하다.

- `particle`
  - bundle `particle`은 절차적 emitter로 해석한다.
  - `placement.kind = point`는 정적 burst, `follow`는 moving emitter, `attached`는 무기/손잡이/캐릭터 부착 emitter로 본다.
  - `composition.kind`와 `animation.motion`에 따라 radial / directional / backward emission preset을 나눈다.

- 디버그 오버레이
  - beam: start/end point, segment bounds, direction arrow
  - trail: projectile head, tail anchor, strip bounds
  - particle: emitter origin, spread cone, approximate content bounds

- 의존 관계
  - projectile snapshot 또는 hitscan result에서 `start/end/velocity`를 전달하는 호출 계약이 먼저 필요하다.
  - 따라서 구현 순서는 `beam 계약 -> trail 계약 -> particle debug/visual polish`가 적절하다.
