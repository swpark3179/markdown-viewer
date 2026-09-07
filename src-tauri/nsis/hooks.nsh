; 탐색기 통합 설정.
;
; 기본 연결 프로그램(.md 파일을 더블 클릭했을 때 열리는 앱)은 그대로 둔다.
; 대신 Notepad++의 "Edit with Notepad++"처럼
;   - 오른쪽 클릭 메뉴에 "마크다운 뷰어로 열기" 항목을 추가하고
;   - "연결 프로그램" 후보 목록에 이 앱을 올린다.
; 그래서 기본 마크다운 편집기를 바꾸지 않아도 이 앱으로 문서를 열 수 있다.

!define MDV_PROGID "MarkdownViewer.Document"
!define MDV_VERB "MarkdownViewer.Open"
!define MDV_VERB_LABEL "마크다운 뷰어로 열기"

; 탐색기에 연결 변경을 알린다. (SHCNE_ASSOCCHANGED, SHCNF_FLUSH)
!macro MDV_NOTIFY_SHELL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

; 오른쪽 클릭 메뉴 항목. 기본 연결 프로그램과 무관하게 항상 보인다.
!macro MDV_ADD_MENU_ENTRY EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\${MDV_VERB}" "" "${MDV_VERB_LABEL}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\${MDV_VERB}" "MUIVerb" "${MDV_VERB_LABEL}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\${MDV_VERB}" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\${MDV_VERB}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro MDV_REMOVE_MENU_ENTRY EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\${MDV_VERB}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell"
  DeleteRegKey /ifempty SHCTX "Software\Classes\SystemFileAssociations\${EXT}"
!macroend

; "연결 프로그램" 후보 등록. 확장자의 기본값("")은 건드리지 않는다.
!macro MDV_ADD_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${MDV_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" "${EXT}" ""
!macroend

!macro MDV_REMOVE_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${MDV_PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; "연결 프로그램" 목록에 이름과 아이콘을 보여 주기 위한 ProgID.
  ; 기본 연결 프로그램으로 지정하지는 않는다.
  WriteRegStr SHCTX "Software\Classes\${MDV_PROGID}" "" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\${MDV_PROGID}" "FriendlyTypeName" "마크다운 문서"
  WriteRegStr SHCTX "Software\Classes\${MDV_PROGID}\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\${MDV_PROGID}\shell\open" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${MDV_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; "다른 앱 선택" 목록에 실행 파일을 등록한다.
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  !insertmacro MDV_ADD_MENU_ENTRY ".md"
  !insertmacro MDV_ADD_MENU_ENTRY ".markdown"

  !insertmacro MDV_ADD_OPEN_WITH ".md"
  !insertmacro MDV_ADD_OPEN_WITH ".markdown"
  !insertmacro MDV_ADD_OPEN_WITH ".txt"

  !insertmacro MDV_NOTIFY_SHELL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 앱 데이터 삭제 단계에서 셸 컨텍스트가 바뀔 수 있으므로 정리는 제거 전에 한다.
  !insertmacro MDV_REMOVE_MENU_ENTRY ".md"
  !insertmacro MDV_REMOVE_MENU_ENTRY ".markdown"

  !insertmacro MDV_REMOVE_OPEN_WITH ".md"
  !insertmacro MDV_REMOVE_OPEN_WITH ".markdown"
  !insertmacro MDV_REMOVE_OPEN_WITH ".txt"

  DeleteRegKey SHCTX "Software\Classes\${MDV_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"

  !insertmacro MDV_NOTIFY_SHELL
!macroend
