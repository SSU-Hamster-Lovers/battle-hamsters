# 맵 설계

## 데이터 포맷

**JSON** 사용.

| 장점 | 설명 |
|------|------|
| 범용성 | Phaser (JS) + Rust (serde_json) 모두 호환 |
| 도구 | Tiled 에디터 등이 JSON 지원 |
| 버전관리 | diff로 변경 사항 추적 용이 |

## 기본 구조

```json
{
  "id": "arena_01",
  "name": "기본 아레나",
  "width": 1280,
  "height": 720,
  "spawnPoints": [
    { "x": 100, "y": 360 },
    { "x": 1180, "y": 360 }
  ],
  "terrain": [...],
  "collision": [...],
  "hazards": [...],
  "weaponSpawns": [...]
}
```

## 구성 요소

| 요소 | 설명 |
|------|------|
| terrain | 지형 (바닥, 벽 등) |
| collision | 충돌 영역 |
| spawn_points | 스폰 위치 |
| weapon_spawns | 무기 스폰 위치 |
| hazards | 위험 구역 (낙사 등) |
| decorations | 장식 (시각적 요소) |

## 설계 원칙

- 공정성: 스폰 위치 대칭
- 다양성: 다양한 전략 가능
- 스폰킬 방지: 안전한 스폰 위치
