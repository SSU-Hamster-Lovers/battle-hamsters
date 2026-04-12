# 미니 스펙: 무기 표현 v1

작업명:
무기 표현 v1 정의

목표:
무기 시각 표현을 `필드 pickup`, `장착 상태`, `발사 VFX` 세 레이어로 분리하고, 아트가 없어도 일관된 fallback 으로 동작하는 표현 규칙을 정리한다.

이번 범위:
- 필드에 놓인 무기 표현 규칙을 정의한다.
- 햄스터가 장착한 무기 overlay 방향을 정의한다.
- 무기 종류별 발사 연출 분리 기준을 정리한다.
- 첫 구현 대상을 `Acorn Blaster pickup sprite 1차` 로 고정한다.

건드리는 스펙/문서:
- `docs/game-design/weapon-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`

비목표:
- 실제 전 무기 아트 제작 완료
- 애니메이션 atlas 최종 규격 확정
- 피격/사망 VFX 전체 재설계

검증 방법:
- 후속 구현에서 현재 `renderWeaponPickups` placeholder 를 데이터 기반 표현으로 교체 가능한지 확인
- 무기 스프라이트가 없는 상태에서도 glyph/label fallback 만으로 식별이 가능한지 확인

## 1. 배경

현재 월드 무기 pickup 은 단색 타원과 텍스트 라벨로만 보인다. 전투 규칙은 이미 무기 중심으로 굴러가고 있으므로, 표현도 `무기가 무엇인지`, `누가 무엇을 들고 있는지`, `어떤 식으로 발사됐는지` 가 즉시 읽혀야 한다.

## 2. 표현 레이어

### A. 필드 pickup

- 월드에 놓인 무기 오브젝트의 외형
- 줍기 전 상태에서 무기 식별을 담당한다.

### B. 장착 overlay

- 플레이어가 현재 들고 있는 무기의 외형
- 방향 전환, 손 위치, 기본 자세와 함께 읽혀야 한다.

### C. 발사 VFX

- 공격 순간의 표현
- 판정 방식과 발사 감각을 읽히게 한다.

## 3. 공통 원칙

- 무기 표현은 전투 판정과 분리된 `presentation layer` 로 둔다.
- 스프라이트가 아직 없더라도 glyph/code fallback 이 반드시 있어야 한다.
- 같은 무기는 `pickup`, `equip`, `fire` 에서 같은 시각 언어를 공유해야 한다.
- placeholder 단계에서도 무기 종류를 빠르게 식별할 수 있어야 한다.

## 4. 필드 pickup 규칙

목표는 메탈 슬러그식 `패키지 + 식별 코드` 감각이다.

표현 구성:

- `pickup body`
  - 기본 실루엣 또는 crate/bundle 형태
- `weapon glyph`
  - 짧은 철자 코드 또는 픽토그램
- `rarity/source accent`
  - 스폰/드랍/보상 출처 또는 희귀도에 따른 보조 색상

1차 규칙:

- 필드 무기에는 최소한 아래 중 둘 이상이 동시에 보여야 한다.
  - 실루엣
  - glyph/code
  - 색상 accent
- 텍스트 이름 전체를 항상 노출하는 방식은 debug/fallback 로만 남긴다.
- resource 숫자는 기본 pickup 표현에 상시 노출하지 않는다.
  - 필요하면 hover/debug 또는 아주 작은 보조 표기로 제한한다.

## 5. fallback 계층

무기 표현은 아래 우선순위로 결정한다.

1. 전용 sprite/frame
2. 공용 pickup body + weapon glyph
3. 공용 pickup body + 짧은 코드 텍스트
4. 현재 방식의 이름 라벨

즉, 아트가 일부만 준비된 상태에서도 시스템 전체는 깨지지 않아야 한다.

## 6. 무기 코드 규칙

각 무기는 짧은 식별 코드를 가질 수 있다.

예시:

- `paws` -> `PW`
- `acorn_blaster` -> `AB`
- `seed_shotgun` -> `SG`
- `laser_cutter` -> `LZ`

원칙:

- 2자 또는 3자 이내
- 한눈에 구분 가능
- sprite가 없는 단계에서도 pickup glyph 로 재사용 가능

## 7. 장착 overlay 규칙

- 햄스터는 무기를 주운 뒤 손에 들고 있는 것이 보여야 한다.
- 본체 sprite 와 무기 sprite 는 분리된 render node 로 둔다.
- 최소 1차 기준:
  - 본체
  - 무기 overlay
  - 좌/우 반전
  - 무기 anchor offset

추가 원칙:

- 무기 overlay 는 플레이어 본체의 애니메이션을 가리지 않아야 한다.
- 큰 무기는 몸통 앞, 근접 무기는 손 근처에 붙는 식으로 anchor 를 개별 조정할 수 있어야 한다.

## 8. 발사 VFX 규칙

무기별 최종 연출은 달라도, 판정 방식별 기본 문법은 통일한다.

### `Paws`

- 손 앞에서 원형 충격파가 짧게 커진다.
- 근접 타격의 범위를 감각적으로 읽히게 한다.

### 총알/히트스캔 계열

- 총구 화염 또는 짧은 발사 flash
- 필요하면 짧은 tracer 를 추가
- 현재 얇은 선 보조 표현은 점진적으로 제거한다.

### 레이저/beam 계열

- 선형 beam 자체는 유지 가능
- 대신 색, 두께, 끝단 flare, 지속 흔들림으로 개성을 준다.

### 투사체 계열

- 발사 순간 flash + 실제 날아가는 탄체 sprite
- 착탄 시 작은 impact burst 를 둔다.

## 9. 권장 데이터 방향

전투 수치가 담긴 `WeaponDefinition` 에 모든 표현 필드를 바로 밀어넣기보다, 표현 전용 계약을 별도로 두는 쪽을 우선 추천한다.

예시 방향:

```ts
type WeaponPresentation = {
  weaponId: string;
  code: string;
  pickup: {
    style: "sprite" | "bundle_glyph" | "label_fallback";
    accentColor?: string;
  };
  equip: {
    anchorX: number;
    anchorY: number;
    flipWithDirection: boolean;
  };
  fire: {
    style: "paws_pulse" | "muzzle_flash" | "beam" | "projectile";
  };
};
```

의도:

- 수치 밸런스와 렌더링 자산을 느슨하게 분리
- placeholder 에서 실제 아트로 넘어갈 때 서버 로직 영향 최소화

## 10. 첫 구현 범위

첫 구현은 아래까지만 잡는다.

1. `Acorn Blaster` 필드 pickup 을 전용 sprite 또는 `bundle + AB glyph` 로 교체
2. 현재 이름 라벨 기반 렌더를 fallback 로 유지
3. 드랍 무기와 스폰 무기를 색상 accent 로 구분

이 단계에서는 장착 overlay 와 발사 VFX 를 설계만 하고 구현은 다음 단계로 넘겨도 된다.

## 11. 현재 구현과의 관계

- 현재 `apps/game/src/main.ts` 는 pickup 을 타원 + 이름 라벨로만 그린다.
- 이 문서는 pickup sprite 도입을 시작점으로, 이후 장착 overlay 와 무기별 VFX 로 확장하기 위한 기준이다.

## 12. 구현 순서 제안

1. `weapon presentation registry` 또는 정적 매핑 도입
2. `Acorn Blaster` pickup 표현 교체
3. glyph/code fallback 추가
4. 장착 overlay node 분리
5. 무기별 발사 VFX registry 도입
