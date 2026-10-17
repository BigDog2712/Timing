@echo off
rem Start the TickBar desktop dev mode from a terminal that has the MSVC environment loaded.
rem The Rust msvc target needs link.exe plus the Windows SDK LIB/INCLUDE paths, and VS Build
rem Tools does not put them on PATH, so a bare npm run tauri dev fails with linker not found.
rem Keep this file ASCII-only with CRLF endings - cmd.exe reads batch files with the OEM codepage.
rem Do not use %ProgramFiles(x86)% here: its parentheses break cmd parsing inside if-blocks.
setlocal

set "REPO=%~dp0.."
set "VCVARS="

set "VSWHERE=C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "VCVARS=%%i"
)

if not defined VCVARS set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
  echo [ERROR] vcvars64.bat not found.
  echo         Install "Visual Studio Build Tools" with the "Desktop development with C++" workload.
  exit /b 1
)

call "%VCVARS%" >nul 2>&1
if errorlevel 1 goto vcfail

pushd "%REPO%" || exit /b 1
call npm.cmd run tauri dev
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%

:vcfail
rem The path is echoed outside any parenthesised block: a value like "Program Files (x86)"
rem inside if-( ) breaks cmd parsing.
echo [ERROR] Failed to load the MSVC environment from "%VCVARS%"
exit /b 1