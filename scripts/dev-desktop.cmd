@echo off
rem 在已加载 MSVC 环境的终端里启动 TickBar 桌面开发模式。
rem 原因：Rust 的 msvc 目标需要 link.exe 与 Windows SDK 的 LIB/INCLUDE，
rem 而 VS Build Tools 默认不写入系统 PATH，直接 npm run tauri dev 会报 linker not found。
setlocal

set "REPO=%~dp0.."
set "VCVARS="

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "VCVARS=%%i"
)

if not defined VCVARS set "VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
  echo [错误] 找不到 vcvars64.bat。
  echo        请安装 "Visual Studio Build Tools" 并勾选 "使用 C++ 的桌面开发"。
  exit /b 1
)

call "%VCVARS%" >nul 2>&1
if errorlevel 1 (
  echo [错误] 加载 MSVC 环境失败：%VCVARS%
  exit /b 1
)

pushd "%REPO%" || exit /b 1
call npm run tauri dev
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
