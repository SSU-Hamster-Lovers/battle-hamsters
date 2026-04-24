# Mini-Spec: VFX Runtime Phase 4.1 — Semantics Debug Overlay

작업명:
VFX bundle semantics 디버그 오버레이

목표:
게임 클라이언트의 기존 debug 모드에서 번들 VFX가 어떤 `anchor/pivot/content bounds`로 배치됐는지 즉시 확인할 수 있게 만들어, 생성기 문제와 런타임 배치 문제를 빠르게 구분한다.

이번 범위:
- `@battle-hamsters/vfx-runtime`의 `playEffect()` 옵션에 semantics debug overlay 플래그 추가
- sprite/animation 번들 VFX 재생 시 debug 모드에서 anchor cross, pivot 라벨, image bounds, content bounds를 표시
- `apps/game/src/vfx-bundle-integration.ts`와 `apps/game/src/main.ts`에서 기존 debug 토글 상태를 번들 재생 경로로 전달
- 현재 구현 문서 갱신

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/technical/mini-spec-vfx-runtime-phase4-semantics.md`
- `packages/vfx-runtime/renderer.ts`
- `apps/game/src/vfx-bundle-integration.ts`
- `apps/game/src/main.ts`

비목표:
- beam / trail / particle의 full semantics 런타임 해석
- 별도 디버그 패널 UI 추가
- semantics overlay의 지속 추적 편집 기능
- 생성기(bundle authoring) 쪽 semantics 계산 규칙 변경

검증 방법:
- 타입체크: `@battle-hamsters/vfx-runtime`, `@battle-hamsters/game`
- 게임 빌드 통과
- 코드 리뷰 기준으로 debug 모드에서 fire/hit 번들 경로가 semantics overlay 옵션을 전달함을 확인

---

## 구현 메모

- overlay는 기존 `Alt + Shift + D` debug 토글을 그대로 따른다.
- anchor cross는 실제 effect가 배치된 월드 좌표 `(x, y)`에 그린다.
- image bounds는 Phaser `origin`이 반영된 최종 sprite/image 박스를 기준으로 표시한다.
- `contentBounds`가 있으면 image bounds 안쪽에 별도 rectangle로 다시 표시한다.
- `flipX`가 적용된 경우 `contentBounds.left/right`는 미러링된 화면 기준으로 계산한다.
