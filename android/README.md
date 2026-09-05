# AMR 알람 Android 앱

## Android Studio에서 실행

1. Android Studio를 설치합니다.
2. `android/` 폴더를 Android Studio로 엽니다.
3. Gradle 동기화가 끝나면 Android 휴대폰을 USB로 연결합니다.
4. 앱을 실행합니다.
5. 앱의 `알림 수집 권한 설정`을 눌러 `AMR 알람 알림 수집`을 허용합니다.
6. 카카오톡 또는 문자 알림을 받으면 서버로 자동 전송됩니다.

앱은 `https://amr-alarm.onrender.com`을 내부 WebView로 열고, 알림 수집 서비스가 다음 서버로 캡처를 전송합니다.

- `POST https://amr-alarm.onrender.com/api/ingest`
- 카카오톡은 `source=kakao`
- 문자 앱은 `source=sms`

## APK 생성

Android Studio 메뉴에서 `Build > Build Bundle(s) / APK(s) > Build APK(s)`를 선택합니다.

생성된 APK는 `app/build/outputs/apk/debug/app-debug.apk`에 있습니다.
