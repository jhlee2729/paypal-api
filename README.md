## Paypal API - Get Transaction Search - List transactions
### 1. paypal-refresh-access-token.js
- is_run=1인 계정 정보 가져오기
- access-token 발급
- app_id 기준 업데이트
- 계정 별 access-token 갱신(만료시간 : 9시간) - 2시간마다 갱신

### 2. paypal-running.js (실행 파일)
### 3. paypal-api.js
#### 1-1. app_paypal_api_history 테이블의 데이터가 없는 경우
- config.json에 설정 된 start_date를 시작날짜 기준으로 호출 시작 (시작날짜 설정)
```json
"setting_date": {
    "start_date":"2023-01-01 00:00:00"
}
```
#### 1-2. app_paypal_api_history 테이블의 데이터가 있는 경우(start_date, end_date)
- 가장 최근 end_date가 start_date로 설정

#### 2. 기본 end_date = start_date + 2주 (2주 간격으로 수집)
#### 계산 된 end_date가 현재 시간보다 더 클 경우, end_date = 현재시간을 넣어줌(현재시간-4시간)
#### 참고 : 현재 시간은 4시간 이전으로 계산된 시간임(리스트 호출에 나타나는 반영시간 최대 3시간)

### DB 정보
- app_paypal_sync
- app_paypal_api_history
- app_paypal_transaction
