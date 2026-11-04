; TickBar 安装器（NSIS 3 / MUI2）
; ---------------------------------------------------------------
; 用法（在仓库根执行）：
;   makensis /DAPP_ROOT="%CD%" /DAPP_VERSION=0.1.0 scripts\installer\TickBar.nsi
; 或直接跑 scripts\build-installer.cmd（会自动带上这两个宏）。
;
; 口径：
;   - 按用户安装到 %LOCALAPPDATA%\Programs\TickBar，不需要管理员权限
;   - 卸载时不删用户数据（%APPDATA%\com.tickbar.app 里的 SQLite 与日志）
;   - 内嵌 WebView2 检测：缺失只提示，不阻断（Win11 / 已更新的 Win10 自带）
; ---------------------------------------------------------------

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef APP_ROOT
  !define APP_ROOT "..\.."
!endif
!ifndef APP_VERSION
  !define APP_VERSION "0.1.0"
!endif

!define APP_NAME      "TickBar"
!define APP_PUBLISHER "TickBar"
!define APP_EXE       "TickBar.exe"
!define APP_SRC_EXE   "${APP_ROOT}\src-tauri\target\release\tickbar.exe"
!define APP_SRC_PLUG  "${APP_ROOT}\plugins"
!define APP_ICON      "${APP_ROOT}\src-tauri\icons\icon.ico"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TickBar"
!define APP_REG_KEY   "Software\TickBar"

Name "${APP_NAME} ${APP_VERSION}"
BrandingText "${APP_NAME} ${APP_VERSION}"
OutFile "${APP_ROOT}\release\TickBar_${APP_VERSION}_x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\TickBar"
InstallDirRegKey HKCU "${APP_REG_KEY}" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show
XPStyle on

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey "FileVersion"     "${APP_VERSION}.0"
VIAddVersionKey "LegalCopyright"  "${APP_PUBLISHER}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"

!define MUI_ICON   "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "安装 ${APP_NAME} ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "一个常驻屏幕边缘的悬浮计时条：按一下就开计时，不占工作区。$\r$\n$\r$\n数据全部存在本机（SQLite），无账号、不联网。$\r$\n$\r$\n点击「下一步」继续。"

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_LINK "查看发布说明（RELEASE-NOTES-v${APP_VERSION}.md）"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\RELEASE-NOTES-v${APP_VERSION}.md"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ---------- 工具宏 ----------
!macro KillRunning
  DetailPrint "关闭正在运行的 ${APP_NAME}…"
  nsExec::Exec 'taskkill /IM ${APP_EXE} /F'
  Pop $0
!macroend

; 升级安装时默认目录由 InstallDirRegKey 提供；不要再用 .onInit 改写 $INSTDIR，
; 否则会盖掉用户在目录页选的路径和命令行的 /D 参数。

Function CheckWebView2
  ; EdgeUpdate 客户端键；HKLM 32 位视图 + HKCU 两处都查
  SetRegView 32
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $2 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  SetRegView lastused
  ${If} $1 == ""
  ${AndIf} $2 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到 Microsoft Edge WebView2 运行时。$\r$\n$\r$\n${APP_NAME} 用它渲染界面，缺失时窗口会是空白。$\r$\n请先安装「WebView2 Runtime」（微软官网免费下载），再启动本程序。$\r$\n$\r$\n安装过程可以继续。"
  ${EndIf}
FunctionEnd

Section "主程序" SecMain
  SectionIn RO
  Call CheckWebView2
  !insertmacro KillRunning

  SetOutPath "$INSTDIR"
  SetOverwrite on
  File "/oname=${APP_EXE}" "${APP_SRC_EXE}"

  ; 插件目录：宿主按 exe 同级 plugins\ 扫描（0.1.1 起就是「用户插件目录」本身）。
  ; 目前没有随包插件（md-sync 已回归内建），这里只建空目录，用户往里放自己的插件。
  SetOutPath "$INSTDIR\plugins"
  SetOutPath "$INSTDIR"

  ; 发布说明（存在才拷，避免构建期顺序依赖）
  !if /FileExists "${APP_ROOT}\RELEASE-NOTES-v${APP_VERSION}.md"
    File "/oname=RELEASE-NOTES-v${APP_VERSION}.md" "${APP_ROOT}\RELEASE-NOTES-v${APP_VERSION}.md"
  !endif

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${APP_REG_KEY}" "InstallDir" "$INSTDIR"

  ; 卸载项
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "开始菜单快捷方式" SecMenu
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

Section "桌面快捷方式" SecDesktop
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
SectionEnd

Section "Uninstall"
  !insertmacro KillRunning

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\RELEASE-NOTES-v${APP_VERSION}.md"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\plugins"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_REG_KEY}"

  ; 用户数据保留：%APPDATA%\com.tickbar.app（SQLite / 日志 / 备份）
  DetailPrint "用户数据保留在 %APPDATA%\com.tickbar.app"
SectionEnd
