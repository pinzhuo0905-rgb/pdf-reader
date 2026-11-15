; electron-builder 自带的 NSIS 模板把「打开方式」命令写成
;   <安装路径>\PDF Reader.exe "%1"
; 安装路径里只要有空格（默认的 %LOCALAPPDATA%\Programs\PDF Reader 就有），
; 这条命令就会被 Windows 当成 "D:\PDF" + 参数来解析，双击 PDF 直接失败。
; 这里在安装完成后用带引号的版本重写一次。
;
; ProgId 用中文（"PDF 文档"），为避免 .nsh 的编码问题，改为从 .pdf 的默认值读出来。

!macro customInstall
  ReadRegStr $0 SHCTX "Software\Classes\.pdf" ""
  ${If} $0 != ""
    WriteRegStr SHCTX "Software\Classes\$0\shell\open\command" "" '"$INSTDIR\PDF Reader.exe" "%1"'
  ${EndIf}
!macroend
