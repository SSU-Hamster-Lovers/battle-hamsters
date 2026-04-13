# 미니 스펙 초안: 전투 표현 polish v0

작업명:
전투 표현 polish 후속 정리

목표:
현재 1차로 들어간 무기/피격/사망 연출을 실제 플레이 감각에 맞게 다듬고, 무기별 차별화와 자산 교체 방향을 정리한다.

이번 범위:
- 무기별 피격 파티클 차별화
- `damageEvents` 정밀도 개선
- 사망 더미를 실제 시체/래그돌 연출로 확장하기 전 단계 규칙 정리
- HUD/킬로그/피드백 UI 후속 방향 정리

건드리는 스펙/문서:
- `docs/game-design/weapon-design.md`
- `docs/technical/sync-protocol.md`
- `docs/technical/current-implementation.md`
- `docs/ROADMAP.md`

비목표:
- 실제 스프라이트 atlas 제작 완료
- 뼈대 기반 래그돌 시스템
- 화면 흔들림/사운드 시스템 전체 설계

검증 방법:
- 플레이 테스트로 무기별 가독성 확인
- 피격/사망 연출이 전장 가시성을 해치지 않는지 점검

## 1. 무기별 피격 차별화

- `Acorn Blaster`
  - 밝은 파편 + 짧은 탄 파편 느낌 유지
  - 현재 구현 완료
- `Paws`
  - 짧은 먼지/충격파 계열
  - 현재 구현 완료
- 추후 beam
  - 선형 잔광 + 작은 burn spark 계열
- 추후 투사체
  - 피격점 burst + 조각 파편 계열

## 2. `damageEvents` 정밀도 후속

- 현재 `impactPoint` 는 몸통 근처 근사치다.
- 후속 단계에서는 아래를 검토한다.
  - 충돌 시점의 실제 교차점 계산
  - 무기별 hit volume 차이에 따른 `impactPoint` 보정
  - 연속 히트/beam 을 위한 다중 이벤트 병합 규칙

## 3. 사망 더미 후속

- 현재는 단일 sprite 기반의 임시 death echo 다.
- 후속 단계 후보:
  - 무기 사망: 짧은 시체/더미 sprite
  - 낙사: 더 빠른 하강 + 회전 + 화면 밖 소멸
  - 즉사 함정: 함정 종류별 전용 vanish 연출

## 4. HUD/피드백 UI

- 하단 HUD 실제 배치
- 킬로그 카드 + 아이콘화
- 피격 시 미세한 화면 테두리 flash 또는 HP 변화 강조 검토

## 5. 자산 교체 방향

- 현재 코드 생성 텍스처를 유지하되, 자산 준비 시 아래 순서로 교체한다.
  1. 무기 pickup
  2. 무기 equip overlay
  3. 발사 VFX atlas
  4. 피격 파티클 sprite
