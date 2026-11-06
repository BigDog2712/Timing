@echo off
rem Build the Timing desktop release. Delegates the actual steps to scripts\build-desktop.mjs
rem (V0.11.6, ADR-051): one Rust compile, two shapes.
rem
rem Usage:
rem   build-release.cmd             portable zip + NSIS installer (both)
rem   build-release.cmd portable    portable zip only
rem   build-release.cmd installer   NSIS installer only
rem
rem Same reason as dev-desktop.cmd: the Rust msvc target needs link.exe plus the Windows SDK
rem LIB/INCLUDE paths, and VS Build Tools does not put them on PATH by default.
rem Keep this file ASCII-only with CRLF endings - cmd.exe reads batch files with the OEM codepage.
setlocal

set "REPO=%~dp0.."
set "MODE=%~1"
set "FLAG="

if /i "%MODE%"=="portable"  set "FLAG=--portable"
if /i "%MODE%"=="installer" set "FLAG=--installer"
if /i "%MODE%"=="all"       set "FLAG="
if /i "%MODE%"=="both"      set "FLAG="
if not "%MODE%"=="" if not defined FLAG if /i not "%MODE%"=="all" if /i not "%MODE%"=="both" (
  echo [ERROR] Unknown mode "%MODE%". Use portable, installer or all.
  exit /b 2
)

set "VCVARS="

rem Do not use %ProgramFiles(x86)% here: its parentheses break cmd parsing inside if-blocks.
set "VSWHERE=C:/Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "VCVARS=%%i"
)

if not defined VCVARS set "VCVARS=C:/Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=C:/Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
  echo [ERROR] vcvars64.bat not found.
  echo         Install "Visual Studio Build Tools" with the "Desktop development with C++" workload.
  exit /b 1
)

call "%VCVARS%"
if errorlevel 1 goto vcfail

pushd "%REPO%" || exit /b 1

rem The frontend/rust rebuild decision lives in build-desktop.mjs (dist fingerprint, not
rem "cargo clean -p timing"). Do not add cleaning steps here - they would defeat it.
if defined FLAG (
  node scripts\build-desktop.mjs %FLAG%
) else (
  node scripts\build-desktop.mjs
)
if errorlevel 1 goto fail

popd
exit /b 0

:vcfail
rem The path is echoed outside any parenthesised block: a value like "Program Files (x86)"
rem inside if-( ) breaks cmd parsing.
echo [ERROR] Failed to load the MSVC environment from "%VCVARS%"
exit /b 1

:fail
echo [ERROR] Build failed, see the output above.
popd
exit /b 1
