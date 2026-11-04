@echo off
rem Build the Timing Windows installer (NSIS) plus the portable exe.
rem
rem Why this script exists: `npm run tauri build` needs to download the NSIS + WiX toolchain
rem from GitHub. On machines where GitHub is unreachable the bundling step fails after the
rem Rust build has already succeeded. This script skips the downloader entirely: it compiles
rem timing.exe itself and then runs a local makensis on scripts\installer\Timing.nsi.
rem
rem Requirements:
rem   - MSVC build tools + Windows SDK (same as dev-desktop.cmd)
rem   - makensis 3.x, either on PATH or pointed at by the MAKENSIS environment variable
rem
rem Keep this file ASCII-only with CRLF endings - cmd.exe reads batch files with the OEM codepage.
setlocal

set "REPO=%~dp0.."
set "VCVARS="
set "VSWHERE=C:/Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "VCVARS=%%i"
)
if not defined VCVARS set "VCVARS=C:/Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=C:/Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" goto novc

call "%VCVARS%" >nul 2>&1

rem vcvars64 locates the Windows SDK through reg.exe. When that lookup is blocked the SDK
rem include/lib paths stay empty and the linker cannot find kernel32.lib - fall back to the
rem SDK folders on disk in that case.
echo %LIB% | find /i "Windows Kits" >nul || call :sdkfallback

if not defined MAKENSIS call :findmakensis
if not defined MAKENSIS goto nomakensis

pushd "%REPO%" || goto fail

echo [1/4] Building the frontend ...
call npm.cmd run build
if errorlevel 1 goto fail

echo [2/4] Building the Rust release binary ...
pushd src-tauri || goto fail
cargo build --release --features custom-protocol
if errorlevel 1 ( popd & goto fail )
popd

echo [3/4] Copying the portable exe to release\ ...
if not exist release mkdir release
copy /y "src-tauri\target\release\timing.exe" "release\Timing-portable.exe" >nul

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
echo        version %VER%

echo [4/4] Compiling the NSIS installer ...
"%MAKENSIS%" -V2 "-DAPP_ROOT=%CD%" "-DAPP_VERSION=%VER%" "scripts\installer\Timing.nsi"
if errorlevel 1 goto fail

echo.
echo Done: %REPO%\release\Timing_%VER%_x64-setup.exe
popd
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

:findmakensis
where makensis >nul 2>&1 && for /f "delims=" %%i in ('where makensis') do set "MAKENSIS=%%i"
if not defined MAKENSIS if exist "%LOCALAPPDATA%\tauri\NSIS\makensis.exe" set "MAKENSIS=%LOCALAPPDATA%\tauri\NSIS\makensis.exe"
exit /b 0

:novc
echo [ERROR] vcvars64.bat not found.
echo         Install "Visual Studio Build Tools" with the "Desktop development with C++" workload.
goto fail

:nomakensis
echo [ERROR] makensis not found.
echo         Install NSIS 3.x, or set MAKENSIS to the full path of makensis.exe.
goto fail

:fail
echo.
echo [ERROR] Build failed, see the output above.
pause >nul
exit /b 1
