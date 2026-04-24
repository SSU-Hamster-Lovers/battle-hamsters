# Mini-Spec: VFX Runtime Phase 4 — Semantics Pivot / Flip 적용

작업명:
VFX bundle semantics runtime 반영

목표:
`bundle.json`의 `semantics.pivot`과 기본 방향 정보를 Phaser 런타임에서 실제 draw origin에 반영해, `muzzle_flash`와 `hit_vfx`가 더 이상 무조건 중앙 정렬로 렌더링되지 않게 한다.

이번 범위:
- `packages/shared/vfx-bundle.ts`에 semantics 타입 동기화
- `packages/vfx-runtime/renderer.ts`에서 sprite/animation effect의 pivot origin 반영
- `playEffect()`에 `flipX` 옵션 추가
- `apps/game/src/vfx-bundle-integration.ts`, `apps/game/src/main.ts`에서 fire VFX에 방향 flip 전달
- 현재 구현 문서 갱신

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/technical/mini-spec-vfx-runtime-phase3.md`
- `packages/shared/vfx-bundle.ts`
- `packages/vfx-runtime/renderer.ts`
- `apps/game/src/vfx-bundle-integration.ts`
- `apps/game/src/main.ts`

비목표:
- beam/trail/particle의 full semantics 해석
- `semanticAnchor`를 게임 좌표 계산 로직 전체에 반영
- 무기 프리셋별 semantics 편집 UI
- 기존 절차적 fallback의 모양 변경

검증 방법:
- 타입체크: `@battle-hamsters/vfx-runtime`, `@battle-hamsters/game`
- 게임 빌드 통과
- 코드 리뷰 기준으로 `muzzle_flash`/`hit_vfx`의 draw origin이 semantics pivot을 사용함을 확인

---

## 구현 메모

- sprite/animation은 Phaser `setOrigin(x, y)`로 semantics pivot을 직접 반영한다.
- `muzzle_flash`처럼 방향성이 있는 effect는 호출부에서 `flipX`를 넘겨 좌우를 뒤집는다.
- `hit_vfx`는 기본적으로 중심형이므로 `flipX`를 쓰지 않는다.
- semantics가 없으면 기존 `(0.5, 0.5)` origin 동작을 유지한다.

