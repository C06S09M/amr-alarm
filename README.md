# AMR 캡처 알람 (PWA)

폰에 오는 소통(카톡·문자·전화·왓츠앱·보이스톡)을 **MacroDroid**로 한곳에 모으고,
설정한 키워드(예: 견적·발주·PO·납기)가 뜨면 **폰으로 즉시 푸시 알람**을 보내는,
수석님 소유의 독립 실행 웹앱(PWA)입니다. 한번 배포하면 이 챗과 무관하게 스스로 돌아갑니다.

```
[폰 알림: 카톡·문자·전화·왓츠앱]
      │ MacroDroid → HTTP POST
      ▼
[이 앱 서버]  캡처 저장 · 키워드 규칙 판단 · 긴급 시 푸시
      │                         │
      ▼                         ▼
[웹 대시보드(홈화면 앱)]   [폰 푸시 알람 즉시]
```

---

## 1. 로컬에서 먼저 확인 (선택)

```bash
npm install
npm run genkeys                 # VAPID 키 2개 출력 → .env에 붙여넣기
cp .env.example .env            # 값 채우기 (INGEST_TOKEN, VAPID 키)
node --env-file=.env server.js  # http://localhost:3000
```

## 2. 배포 (Render.com 무료 기준)

1. 이 폴더를 GitHub 저장소로 올립니다.
2. https://render.com → **New +** → **Blueprint** → 저장소 선택 (`render.yaml` 자동 인식).
3. 환경변수 입력:
   - `INGEST_TOKEN` : 아무 긴 랜덤 문자열 (MacroDroid와 공유할 비밀번호)
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` : `npm run genkeys` 결과값
   - `VAPID_SUBJECT` : `mailto:본인메일`
4. 배포 완료 후 나오는 주소(예: `https://amr-alarm.onrender.com`)가 **앱 주소**입니다.

> 무료 플랜 주의: 일정 시간 미접속 시 서버가 잠들어(cold start) 첫 알람이 수십 초 지연될 수 있고,
> 디스크가 재배포 시 초기화됩니다. 항상 켜두거나 데이터를 영구 보관하려면 아래 '업그레이드' 참고.
> (다른 무료 대안: Railway, Fly.io, Cloudflare — 어디든 Node 앱을 HTTPS로 띄우면 됩니다.)

## 3. 폰에 앱 설치 (PWA)

1. 안드로이드 **크롬**으로 앱 주소 접속.
2. 우측 상단 메뉴 → **앱 설치**(또는 홈 화면에 추가).
3. 설치된 앱을 열고 상단 **[알림 켜기]** → 권한 **허용**.
4. 하단 **[테스트 알람 보내기]** 로 알림이 오는지 확인.
5. 앱 주소를 열면 바로 대시보드가 표시됩니다.

## 4. MacroDroid 설정 (폰 → 앱으로 캡처 전송)

먼저 안드로이드 **설정 → 알림 접근 허용 → MacroDroid ON** (알림 캡처에 필수).
아래 매크로에서 대괄호 `[...]` 값은 직접 타이핑하지 말고, MacroDroid의 **매직 텍스트 버튼(별표/중괄호)** 을 눌러 목록에서 골라 넣으세요(기기·버전마다 변수명이 조금 다름).

**매크로 A — 메신저 알림(카톡·왓츠앱·보이스톡)**
- 트리거: **기기 이벤트 → 알림 수신(Notification Received)** → 애플리케이션에서 `카카오톡`, `WhatsApp` 선택. ‘지속 알림 제외’ 체크.
- 액션: **연결 → HTTP 요청(HTTP Request)**
  - 방식: `POST`
  - URL: `https://<앱주소>/api/ingest`
  - Content-Type: `application/x-www-form-urlencoded`
  - 본문(Body):
    ```
    token=<발급토큰>&source=[notification_app_name]&sender=[notification_title]&text=[notification_text]&type=msg
    ```
  - (`source`에 `[notification_app_name]` 매직텍스트를 넣으면 앱 이름이 그대로 소스로 들어갑니다.)

**매크로 B — 문자(SMS) 전문**
- 트리거: **기기 이벤트 → SMS 수신(SMS Received)**
- 액션: HTTP POST → `https://<앱주소>/api/ingest`
  - 본문: `token=<발급토큰>&source=sms&sender=[sms_sender]&text=[sms_message]&type=sms`

**매크로 C — 전화 이벤트(부재중/통화 종료)**
- 트리거: **기기 이벤트 → 통화 → 부재중 전화(Missed Call)** (또는 통화 종료)
- 액션: HTTP POST → `https://<앱주소>/api/ingest`
  - 본문: `token=<발급토큰>&source=call&sender=[call_number]&text=부재중/통화 [call_duration]&type=call`

**매크로 D — 통화 요청 캡처(★ 녹음 → 전사 → 요청 요약)**  ← 이게 이 앱의 핵심 목적
사전 준비: 폰 기본 전화 앱에서 **통화 자동 녹음 켜기**(삼성: 전화 → 설정 → 통화 녹음 → 자동 녹음).
녹음 파일이 저장되는 폴더를 확인해 둡니다(삼성 예: `Recordings/Call/` 또는 `Call/`).
- 트리거: **기기 이벤트 → 통화 → 통화 종료(Call Ended)**
- 액션 1: **대기(약 5초)** — 녹음 파일이 저장될 시간을 줍니다.
- 액션 2: **파일 → 최신 파일 찾기**(녹음 폴더에서 가장 최근 파일 경로를 변수에 저장).
- 액션 3: **연결 → HTTP 요청(HTTP Request)**, 방식 `POST`, URL `https://<앱주소>/api/upload-call`
  - 본문 형식: **multipart/form-data (파일 업로드)** — 파일 필드명 `file` 에 위에서 찾은 녹음 파일 첨부.
  - 추가 파라미터: `token=<발급토큰>`, `number=[call_number]`, `duration=[call_duration]`.
- 서버가 녹음을 자동 전사하고, AI가 "상대가 요청한 것"을 한 줄로 뽑아 피드/브리핑에 넣고, 키워드에 걸리면 폰 알람을 보냅니다.

> 통화 전사에는 `OPENAI_API_KEY`(Whisper)가 필요합니다. 없으면 녹음 이벤트만 기록되고 전사는 건너뜁니다.
> MacroDroid 버전이 파일 업로드를 지원하지 않으면, 대안으로 '구글 드라이브 업로드' 액션으로 녹음을 올리고 서버가 폴링하도록 바꿀 수 있습니다(원하면 추가 구현).
> 한국은 본인 통화 녹음이 합법(당사자 녹음)입니다.

> `<발급토큰>`은 배포 시 넣은 `INGEST_TOKEN` 과 똑같아야 합니다.
> 대시보드 ‘설정·연결’의 주소 예시에서 `<발급토큰>` 부분만 실제 토큰으로 바꿔 쓰세요.

## 5. 사용법

- 대시보드에서 **알람 키워드 규칙**을 편집(추가/삭제, 긴급 여부)하고 **저장**.
- 각 키워드에 `영업`, `구매`, `일정` 같은 카테고리를 지정하면 캡처 피드에서 분류별로 필터링할 수 있습니다.
- 규칙에 걸린 캡처만 긴급으로 분류되어 **폰 푸시**가 옵니다. 나머지는 피드에 조용히 쌓입니다.
- 상단 🔔 를 누르면 전체 알람을 **음소거/해제**할 수 있습니다.
- **예약 알람**에서 시간과 반복 요일을 지정하면 정해진 시간에 푸시 알람을 보냅니다. 알람음과 진동은 설정 화면에서 각각 끌 수 있습니다.
- 설정 화면의 MacroDroid 접기를 열면 메신저·문자·전화·통화 녹음용 전송 본문을 바로 복사할 수 있습니다.

### 접근 주의

현재 요청에 따라 로그인 없이 대시보드를 엽니다. 캡처 내용과 업무 기록이 공개될 수 있으므로 실제 운영에서는 접근 제어를 다시 켜는 것을 권장합니다.

---

## 이메일 + AI 브리핑 (2단계 — 이미 구현됨)

서버가 Gmail을 읽고 Claude API로 "오늘 해야 할 것"을 정리해, 평일 아침·퇴근 시각에
자동으로 폰에 브리핑 푸시를 보냅니다. **키를 안 넣어도 앱은 정상 동작**하고(규칙 기반 브리핑),
아래 두 값을 넣으면 자동으로 AI + 이메일 브리핑으로 업그레이드됩니다.

1. **Claude API 키**: https://console.anthropic.com 에서 발급 → 환경변수 `ANTHROPIC_API_KEY`.
   (모델명은 `CLAUDE_MODEL`, 기본 `claude-3-5-sonnet-latest` — 콘솔에서 현재 사용 가능한 모델명으로 맞추세요.)
2. **Gmail 앱 비밀번호**: 구글 계정 → 보안 → 2단계 인증 켠 뒤 **앱 비밀번호** 생성 →
   `GMAIL_USER`(본인 메일), `GMAIL_APP_PASSWORD`(생성된 16자리). IMAP로 최근 메일을 읽습니다.

동작:
- 자동: 평일 **08:00 출근 브리핑 / 18:30 퇴근 브리핑**을 폰 푸시로 발송(`CRON_MORNING`/`CRON_EVENING`로 변경).
- 수동: 앱의 **오늘 브리핑 → 새로고침**(`GET /api/brief`), 또는 `POST /api/brief/run`으로 즉시 생성+푸시.
- 브리핑은 캡처(카톡·문자·전화)와 최근 이메일을 함께 보고 "회신·확인·결정이 필요한 할 일"만 뽑습니다.

3. **통화 전사(선택)**: `OPENAI_API_KEY` 를 넣으면 매크로 D로 올라온 통화 녹음이 자동 전사되어
   "전화로 받은 요청"이 피드·브리핑에 정리됩니다. (이 앱을 만든 핵심 목적)

## 업그레이드(영구 저장)

무료 플랜 디스크는 휘발성입니다. 데이터를 영구 보관하려면 `store.js`를
무료 Postgres(Supabase/Neon)나 Render 영구 디스크(`DATA_DIR=/data`)로 바꾸면 됩니다.

## 폴더 구조
```
server.js        API 서버 (ingest·규칙·푸시·피드·브리핑)
store.js         JSON 파일 저장소
rules.js         키워드 규칙 판정
scripts/genkeys.js  VAPID 키 생성
public/          PWA (index.html, app.js, styles.css, sw.js, manifest, icons)
render.yaml      Render 배포 설정
.env.example     환경변수 예시
```
