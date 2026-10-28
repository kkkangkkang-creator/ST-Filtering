# ST 필터링 (ST Filtering)

AI 메시지의 글자·단어·문구를 지우거나 바꾸는 SillyTavern 확장입니다. 화면(번역문 포함)과 AI에게 보내는 내용에 모두 적용되며, 저장된 채팅 원문은 바꾸지 않습니다.

A SillyTavern extension that deletes or replaces characters, words and phrases in AI messages — on screen (translations included) and in the prompt sent to the model — without ever changing the saved chat.

## 설치

SillyTavern의 확장 설치 화면에 다음 주소를 입력합니다.

```text
https://github.com/kkkangkkang-creator/ST-Filtering
```

설정은 **확장(Extensions) 패널 → ST 필터링**에 있습니다. 확장 목록 위쪽에 표시됩니다.

> **Word Filter에서 옮겨오는 경우:** 처음 켜면 Word Filter의 규칙을 자동으로 가져옵니다. 같은 규칙이 두 번 적용되지 않도록 Word Filter는 꺼 주세요. Word Filter의 "원문 저장 모드"로 이미 바뀐 채팅이 있다면, 끄기 전에 Word Filter에서 **원문 복원**을 먼저 해 두세요. ST 필터링은 원문을 바꾸지 않으므로 그 백업을 읽지 않습니다.

## 어디에 적용되나요

| 대상 | 방식 |
|---|---|
| **화면** | 화면에 그려진 글자를 직접 필터합니다. 확장이 메시지 안에 그리는 번역문(LLM Translator, Interpres, 기본 번역)도 그대로 적용됩니다. 스트리밍 중인 글자, 스와이프, 번역 전환도 자동으로 따라갑니다. |
| **AI에게 보내는 내용** | 생성 직전에 프롬프트에 들어가는 메시지만 필터합니다. 저장된 채팅은 그대로입니다. |

둘은 따로 켜고 끌 수 있습니다. 메시지 편집창, 복사 버튼, TTS는 저장된 원문을 사용하므로 필터가 적용되지 않습니다.

## 규칙

- 찾을 표현과 바꿀 표현을 입력합니다. 바꿀 표현을 비우면 삭제됩니다. 줄바꿈으로 여러 개를 한꺼번에 추가할 수 있습니다.
- 목록에서 바로 수정하고, 규칙별로 켜고 끄고, 순서를 바꿀 수 있습니다.
- **일치 방식**
  - **자동** (기본): 영문만으로 된 표현은 단어 단위, 한글·기호 등은 부분 일치. `rhythmic`은 `rhythmically`에 걸리지 않고, `그녀`는 `그녀는`에도 걸립니다.
  - **부분 일치**: 단어 안쪽까지 찾습니다.
  - **단어**: 앞뒤가 다른 글자와 붙어 있으면 찾지 않습니다. 한글에도 적용됩니다.
  - **정규식**: 직접 정규식을 씁니다. 바꿀 표현에 `$1`, `$<name>`, `$&`를 쓸 수 있습니다.
- 모든 규칙을 한 번에 훑습니다. 같은 위치에서는 더 긴 표현이, 길이가 같으면 위쪽 규칙이 이깁니다. 한 규칙이 바꾼 결과를 다른 규칙이 다시 바꾸지 않습니다.
- 화면에서는 `very <em>much</em>`처럼 꾸밈 태그로 나뉜 문구도 찾습니다. 문단, 줄바꿈, 원문·번역 칸을 넘어서는 찾지 않습니다.
- **삭제 후 남는 공백 정리**: 지운 자리에 공백이 두 칸 남거나 문장부호 앞에 공백이 남지 않게 합니다 (`I like it very much.` → `I like it.`).
- 코드블록·인라인 코드는 기본으로 건너뜁니다(**코드블록 안에도 적용**으로 변경). HTML 태그와 속성, `<style>`/`<script>`, Tavern Helper 렌더링 영역은 항상 건드리지 않습니다.
- **미리보기**에 문장을 붙여 넣으면 결과를 바로 볼 수 있습니다.

## 기타

- `/stfilter on`, `/stfilter off`, `/stfilter toggle`, `/stfilter`(현재 상태)
- **고급 → 추가로 필터할 영역**: 메시지 본문 밖에 따로 그려지는 영역이 있다면 CSS 선택자로 추가합니다.
- 내보내기·가져오기: 설정 전체를 JSON으로 저장합니다. Word Filter 백업 파일을 가져오면 규칙만 추가합니다.

## 개발

`npm install` 후 `npm test`로 엔진·화면 필터·설정과 SillyTavern을 흉내 낸 통합 테스트를 실행합니다.
