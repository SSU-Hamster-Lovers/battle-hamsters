# 미니 스펙 — beam / grab 런타임 v1

## 작업명

beam / grab 런타임 v1

## 목표

기존 문서에 이미 정의된 `beam` 및 `grab` 계열을 실제 런타임 구조에 연결한다.
이 단계는 **Laser Cutter**, **Grab Spear**를 기준 구현체로 삼는다.

> **현재 상태**: 미구현 (후속 작업). 무기 확장 v2 완료 후 착수 예정.

---

## 이번 범위

* `Laser Cutter` JSON 정의 추가
  * `hitType: "beam"`, `fireMode: "channel"`, `resourceModel: "capacity"`
* `Grab Spear` JSON 정의 추가
  * `specialEffect.kind: "grab"` 실제 의미 정의
* `beam` 판정 루프 1차 (지속 판정 + 자원 소모)
* `capacity` 자원 소모 모델 1차 (시간 기반 소모)
* `grab` 상태: 적중 시 짧은 grab, 이동/해제/종료 규칙
* 관련 `PlayerSnapshot` 필드 검토 (`grabState`)
* `current-implementation.md` 갱신

---

## 건드리는 스펙/문서

* `docs/game-design/weapon-design.md`
* `docs/technical/data-formats.md`
* `docs/technical/current-implementation.md`
* `packages/shared/protocol.ts` (`GrabState` 타입)

---

## 비목표

* 상태이상 시스템 연동
* 하드 CC 다단계 설계
* 래그돌 개선
* 최종 beam VFX / SFX

---

## 핵심 결정 (사전 정의)

1. `Laser Cutter`는 `hitType=beam`, `fireMode=channel`, `resourceModel=capacity`를 기준 구현으로 둔다.
2. `Grab Spear`는 `specialEffect.kind=grab`의 실제 런타임 의미를 처음 정의한다.
3. grab은 짧은 하이라이트용 CC이며, 군중 제어 핵심 메타로 키우지 않는다.
4. `GrabState`는 이미 `PlayerSnapshot`에 자리가 있으므로 타입 정의만 구체화하면 된다.

---

## 완료 조건 (미래)

* beam 무기가 시간 기반 자원 소모와 지속 판정을 가진다
* grab 무기가 적중 시 제한된 시간 동안 상대를 붙잡을 수 있다
* 관련 상태값과 해제 규칙이 문서화된다
