# 미니 스펙 — 호출형 무기 / 전장 경고 시스템 v1

## 작업명

호출형 무기 / 전장 경고 시스템 v1

## 목표

직접 발사형 무기와 별도로, 지연 발동형 맵 이벤트를 유발하는 **call-in weapon** 개념을 1차 도입한다.
첫 구현 대상은 `Airstrike Remote`다.

> **현재 상태**: 미구현 (후속 작업). beam/grab 런타임 완료 후 착수 예정.

---

## 이번 범위

* `Airstrike Remote` 무기 정의 추가
* 발동 시 지연 타이머가 있는 world event 생성
* target area 또는 line strike 1차 지원
* 모든 플레이어에게 표시되는 global warning banner 추가
* 위험 지역 바닥 마커 / 카운트다운 표시
* strike 발동 시 AoE damage / knockback 처리
* `current-implementation.md` 갱신

---

## 건드리는 스펙/문서

* `docs/technical/data-formats.md`
* `docs/technical/current-implementation.md`
* 필요 시 신규 `mini-spec-global-alert-ui-v1.md`

---

## 비목표

* 최종 SFX
* 복수 종류의 지원 무기
* 미니맵 완성
* cinematic camera

---

## 핵심 결정 (사전 정의)

1. `Airstrike Remote`는 직접 발사형이 아니라 지연 발동형 world event 무기다.
2. 모든 strike는 명확한 사전 경고를 가져야 한다.
3. 전체 맵 무차별 폭격보다, 초기엔 point 또는 line strike부터 시작한다.
4. 경고 UI는 HUD와 분리된 match-wide overlay 계층으로 둔다.

---

## 완료 조건 (미래)

* 공습 호출 무기가 1회용 또는 희귀 무기로 동작한다
* 모든 플레이어가 경고와 위험 지역을 인지할 수 있다
* AoE 판정과 UI 경고가 동기화된다
