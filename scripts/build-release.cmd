@echo off
rem Build the TickBar desktop release: frontend dist + Rust release exe, copied to release\TickBar.exe.
rem Same reason as dev-desktop.cmd: the Rust msvc target needs link.exe plus the Windows SDK
rem LIB/INCLUDE paths, and VS Build Tools does not put them on PATH by default.
rem Keep this file ASCII-only with CRLF endings - cmd.exe reads batch files with the OEM codepage.
setlocal

set "REPO=%~dp0.."
set "VCVARS="

rem Do not use %ProgramFiles(x86)% here: its parentheses break cmd parsing inside if-blocks.
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

call "%VCVARS%"
if errorlevel 1 goto vcfail

pushd "%REPO%" || exit /b 1

echo [1/3] Building the frontend (tsc + vite build)...
call npm.cmd run build
if errorlevel 1 goto fail

echo [2/3] Building the Rust release binary...
pushd src-tauri || goto fail
rem The frontend assets are embedded at compile time. cargo does not track dist\ as an input,
rem so a fresh dist\ alone leaves the old bundle inside the binary - drop this crate's release
rem artifacts to force the codegen (and with it the new assets) to run again.
cargo clean --release -p tickbar
rem --features custom-protocol embeds dist\ into the binary; without it the release build
rem still points at devUrl (http://localhost:1420) and shows a blank window with no dev server.
cargo build --release --features custom-protocol
if errorlevel 1 (
  popd
  goto fail
)
popd

echo [3/3] Copying the binary to release\TickBar.exe ...
if not exist release mkdir release
copy /y "src-tauri\target\release\tickbar.exe" "release\TickBar.exe" >nul
if errorlevel 1 goto fail

echo Done: %REPO%\release\TickBar.exe
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
