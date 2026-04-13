# 미니 스펙: 화면 밖 캐릭터 방향 표시 v1

## 작업명

`feat/offscreen-indicator-v1`

## 목표

플레이어가 맵 밖 또는 화면 밖으로 날아갔을 때, 슈퍼 스매시 브라더스처럼 **뷰포트 테두리에 방향 화살표 말풍선**을 표시해 위치를 알 수 있게 한다.

---

## 동작 규칙

1. 로컬 플레이어가 현재 카메라 뷰포트 밖에 있을 때 발동
2. 원격 플레이어도 동일하게 적용 (팀 아이덴티티 색으로 구분)
3. 인디케이터 위치: 플레이어 월드 좌표 → 화면 좌표 변환 후, 화면 테두리에 고정
4. 인디케이터 모양: 둥근 말풍선 + 작은 삼각 화살표 (테두리를 가리키는 방향)
5. 인디케이터에는 플레이어 이름 약자(2글자) + HP 비율 표시
6. 화면 안으로 들어오면 즉시 숨김

---

## 계산 방법

```
playerScreenX = playerWorldX - cameraX
playerScreenY = playerWorldY - cameraY

if (0 <= screenX <= W && 0 <= screenY <= H) → 화면 안 → 표시 안 함

else:
  // 화면 테두리와의 교차점 계산
  angle = atan2(screenY - H/2, screenX - W/2)
  clampedX = clamp(screenX, margin, W - margin)
  clampedY = clamp(screenY, margin, H - margin)
  // 테두리 edge에 고정
  indicatorPos = clipToViewportEdge(screenX, screenY, margin)
```

---

## 비주얼 설계

- 말풍선 배경: 반투명 어두운 원 (반지름 18px)
- 화살표: 테두리 방향을 향한 작은 삼각형
- 텍스트: 플레이어 약자 + HP 퍼센트
- 색상: 로컬 플레이어 → 파란계열, 원격 → 빨간계열

---

## 이번 범위

- `apps/game/src/main.ts` — `update()` 루프에서 지속 업데이트되는 indicator 오버레이 렌더링
- 순수 클라이언트 변경, 서버 무관

## 비목표

- 여러 명 있을 때 겹침 처리 (1차는 단순 위치 고정)
- 아이콘 스프라이트 교체 (fallback 도형 사용)
- 생명 수 pip 표시 (1차는 HP 비율만)

---

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `apps/game/src/main.ts` | 오프스크린 인디케이터 렌더링 |

---

## 검증 방법

- 캐릭터를 왼쪽/오른쪽/위쪽/아래쪽으로 날려서 화면 밖으로 보낼 때 테두리에 말풍선 표시
- 화면 안으로 돌아오면 말풍선 사라짐
- 원격 플레이어도 같이 표시 확인
