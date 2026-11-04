@echo off
rem Start the Timing desktop dev mode from a terminal that has the MSVC environment loaded.
rem The Rust msvc target needs link.exe plus the Windows SDK LIB/INCLUDE paths, and VS Build
rem Tools does not put them on PATH, so a bare npm run tauri dev fails with linker not found.
rem Keep this file ASCII-only with CRLF endings - cmd.exe reads batch files with the OEM codepage.
rem Do not use %ProgramFiles(x86)% here: its parentheses break cmd parsing inside if-blocks.
rem Launched from the desktop shortcut ("Timing ???"), so every failure path ends in pause:
rem a double-clicked console closes instantly and the error would be unreadable.
setlocal

set "REPO=%~dp0.."
set "VCVARS="

set "VSWHERE=C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "VCVARS=%%i"
)

if not defined VCVARS set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" goto novc

call "%VCVARS%" >nul 2>&1
if errorlevel 1 goto vcfail

rem vcvars64 locates the Windows SDK through reg.exe. When that lookup is blocked the SDK
rem include/lib paths stay empty and the linker cannot find kernel32.lib - fall back to the
rem SDK folders on disk in that case. Same fallback as build-installer.cmd.
echo %LIB% | find /i "Windows Kits" >nul || call :sdkfallback

pushd "%REPO%" || goto nodir
call npm.cmd run tauri dev
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto devfail
exit /b 0

:sdkfallback
set "SDKROOT=C:/Windows Kits\10"
if not exist "%SDKROOT%\Lib" exit /b 0
for /d %%d in ("%SDKROOT%\Lib\*") do set "SDKVER=%%~nxd"
if not defined SDKVER exit /b 0
set "INCLUDE=%INCLUDE%;%SDKROOT%\Include\%SDKVER%\ucrt;%SDKROOT%\Include\%SDKVER%\um;%SDKROOT%\Include\%SDKVER%\shared;%SDKROOT%\Include\%SDKVER%\winrt;%SDKROOT%\Include\%SDKVER%\cppwinrt"
set "LIB=%LIB%;%SDKROOT%\Lib\%SDKVER%\ucrt\x64;%SDKROOT%\Lib\%SDKVER%\um\x64"
set "PATH=%PATH%;%SDKROOT%\bin\%SDKVER%\x64"
exit /b 0

:novc
echo [ERROR] vcvars64.bat not found.
echo         Install "Visual Studio Build Tools" with the "Desktop development with C++" workload.
goto fail

:vcfail
rem The path is echoed outside any parenthesised block: a value like "Program Files (x86)"
rem inside if-( ) breaks cmd parsing.
echo [ERROR] Failed to load the MSVC environment from "%VCVARS%"
goto fail

:nodir
echo [ERROR] Cannot enter "%REPO%"
goto fail

:devfail
echo.
echo [ERROR] "npm run tauri dev" exited with code %RC%.

:fail
echo.
echo Press any key to close this window.
pause >nul
exit /b 1
