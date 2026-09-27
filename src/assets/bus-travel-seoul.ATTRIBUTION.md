# 서울 버스 구간 운행시간 통계

출처·저작권자: 서울특별시, 서울 열린데이터광장 / 서울시 교통정보 시스템(TOPIS).

원본: https://data.seoul.go.kr/dataList/OA-21217/S/1/datasetView.do

파일: tpss_route_section_speedh_2026.09.07-09.13.zip (공개일 2026-09-21).

이용허락: 공공누리 제1유형(출처표시, 상업적 이용 및 변경 가능).

변경: 일별 구간 평균 운행시간을 시간대별로 산술평균하고 초 단위 정수로 반올림했다. 0과 비정상 값은 관측 없음으로 제외했다. 인접 순번 구간만 포함하며 정류장 ID와 양쪽 순번을 함께 보존한다. 요일·차량 운행횟수로 가중하지 않는다. 실시간 예측자료가 아니다.

원본 CSV SHA-256은 JSON의 sourceSha256에 기록한다. 재생성:

```powershell
node tools/build-bus-travel-data.mjs CSV경로 2026-09-07 2026-09-13
```

기간을 갱신할 때 사용법.md의 통계 기간도 갱신하고 npm run build 및 desktop\build.bat을 실행한다. 통계 종료일로부터 90일이 지난 자료는 소요시간 계산에 사용하지 않는다.
