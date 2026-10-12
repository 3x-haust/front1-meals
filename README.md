# Front1 Meals

프론트원마포점(`FA1N2`)의 Telegram 식단 봇입니다.
별도 식단 API 없이 봇이 아워홈에 직접 요청합니다.

- 봇: https://t.me/lyusungyun_front1_meals_bot
- `/today`, `/tomorrow`, `/week`, `/settings`
- 첫 화면에서 봇 소개를 볼 수 있고, `/start` 또는 `/help`로 사용법과 언어 선택을 표시합니다.
- 기본 한국어. `/settings`에서 English 또는 한국어를 선택하면 저장됩니다.
- 주간 식단은 월요일부터 일요일까지 한 날짜씩 표시합니다. 이전·다음 버튼으로 같은 메시지에서 날짜를 넘깁니다.
- 식단 버튼과 명령 메뉴 설명은 선택한 언어로 표시합니다. `/명령어` 이름은 Telegram 규칙에 따라 영문을 사용합니다.
- 날짜는 요일까지 표시하고 배식 시간은 표시하지 않습니다. 식사 구분은 굵게·밑줄로 표시합니다. 코너명과 칼로리는 굵은 제목에 묶고, 빈 줄 없이 바로 아래에 메뉴·반찬 인용 블록을 표시합니다.
- 등록된 원본 사진만 전송합니다. 사진이 없는 날에는 식단 텍스트만 보냅니다.
- 누구나 봇과의 개인 대화에서 사용할 수 있습니다. 답장과 언어 설정은 대화별로 분리합니다. 단체방에서는 작동하지 않습니다.
- 날짜와 시간은 한국 시간입니다. 주간 식단은 월요일부터 일요일까지이며 휴무와 미등록을 구분합니다.

## 설정과 민감정보

식단 조회에는 사용자 로그인 세션이나 갱신 작업이 필요하지 않습니다.
아워홈 앱의 공통 프로토콜 키도 소스에 넣지 않고 `OURHOME_APP_KEY`로 분리합니다.

로컬 `.env`는 Git에서 제외되며, 저장소에는 빈 `.env.example`만 포함합니다.
`TELEGRAM_TOKEN`, `OURHOME_APP_KEY`를 환경변수로 설정할 수 있습니다.
값이 비어 있으면 기존 macOS Keychain의 `front1-meals` 서비스에서 읽으므로
저장된 비밀값을 평문 파일로 옮길 필요는 없습니다.

`WEBHOOK_SECRET`은 Telegram 웹훅 요청 확인에 사용합니다. 봇 사용자가 입력하는
접근 키나 소유자 계정 제한은 없습니다.

`OURHOME_USERNAME`, `OURHOME_PASSWORD`, `OURHOME_PASSWORD_KEY`는 선택적인 로컬
`bun run scripts/login.ts`에서만 사용합니다. 비어 있으면 Keychain에서 읽습니다.
이 자격증명과 로그인 세션은 봇에 필요하지 않으며 서버에 올리지 않습니다.

## 서버리스 실행

Cloudflare Workers의 `/telegram` 웹훅은 메시지가 들어올 때만 실행됩니다.
대화별 Durable Object가 언어 설정과 처리한 업데이트 번호를 보관하고 해당 대화의 요청을 직렬로 처리합니다.
상주 프로세스, 주기적 로그인, Mac 실행이 필요하지 않습니다.

배포 주소: `https://front1-private-meals.lyusungyun.workers.dev`
Telegram 웹훅 경로: `/telegram`.

```sh
pnpm install
bun test
bun run typecheck
pnpm exec wrangler login
pnpm exec wrangler deploy
```

Workers Free 플랜과 SQLite Durable Objects 무료 할당량으로 운영합니다.
Workers 요청은 하루 10만 건까지 무료이며, 무료 한도 초과 시 요청이 제한됩니다.
유료 플랜 전환이나 별도 도메인 구매는 필요하지 않습니다.
설정은 `wrangler.jsonc`에 있습니다. 비밀값은 Wrangler secrets로만 등록합니다:
`TELEGRAM_TOKEN`, `WEBHOOK_SECRET`, `OURHOME_APP_KEY`.
웹훅 등록 시 URL은 `https://<worker-host>/telegram`, `secret_token`은
`WEBHOOK_SECRET`, `max_connections`는 `1`, `allowed_updates`는
`["message","callback_query"]`로 지정합니다. 같은 봇에 로컬 polling을 동시에 실행하지 마세요.

이미 Keychain 설정을 마쳤다면 `bun run scripts/cloud-setup.ts secrets`가 비밀값을
파일이나 명령줄에 기록하지 않고 Wrangler 표준 입력으로 전달합니다.
배포 URL을 확인한 뒤 `bun run scripts/cloud-setup.ts webhook https://<worker-host>/`로
웹훅과 기본 한국어 명령 메뉴를 등록합니다.

배포된 Worker는 Telegram 웹훅만 받습니다. `/v1/meals`, `/health` 등의
외부 조회 엔드포인트와 별도 식단 API 키는 제공하지 않습니다.

## 로컬 대안

`bun run start`는 `.env` 또는 Keychain 설정으로 Telegram long polling을 실행합니다.
HTTP 서버는 열지 않습니다. 이 방식은 Mac이 켜져 있을 때만 응답합니다.
서버리스 배포에서는 로컬 실행이 필요하지 않습니다.
