// VAPID 키 생성기: npm run genkeys 로 실행 → 출력된 값을 .env 에 붙여넣기
import webpush from 'web-push';
const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID 키가 생성되었습니다. 아래를 .env 파일에 넣으세요:\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\n(PUBLIC 키는 앱에 노출돼도 되지만 PRIVATE 키는 절대 외부에 공개하지 마세요.)\n');
