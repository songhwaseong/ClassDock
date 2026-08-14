' ClassDock 로컬 서버를 백그라운드(콘솔창 숨김)로 실행한다.
' 윈도우 시작 시 자동 실행용 — 부팅 때 브라우저를 띄우지 않도록 CLASSDOCK_NO_BROWSER=1 설정.
' 접속은 브라우저 즐겨찾기로:  http://127.0.0.1:17645/
Set sh = CreateObject("WScript.Shell")
sh.Environment("Process")("CLASSDOCK_NO_BROWSER") = "1"
sh.Run """D:\my\ClassDock.exe""", 0, False
