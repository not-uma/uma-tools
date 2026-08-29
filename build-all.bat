@echo off
setlocal enabledelayedexpansion
title build all uma-tools

REM Run this from INSIDE the uma-tools folder before committing to GitHub.
REM GitHub Pages does not build anything -- it just serves the bundle.js,
REM bundle.css and simulator.worker.js files that you commit.

cd /d "%~dp0"

if not exist "buildtools.mjs" (
    echo Run this from inside the uma-tools folder.
    pause
    exit /b 1
)

REM ---- make sure the engine patch is applied before building ----
findstr /c:"modifierScaling" "uma-skill-tools\RaceSolverBuilder.ts" >nul 2>nul
if errorlevel 1 (
    echo.
    echo   WARNING: the local engine patch is NOT applied.
    echo   Risky Business / Nothing Ventured will drain the whole HP bar.
    echo   Reapply with:  cd uma-skill-tools ^&^& git apply ..\engine-scaling-fix.patch
    echo.
    set /p "GO=  Build anyway? [y/N] "
    if /i not "!GO!"=="y" exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM ---- Jekyll would choke on 3000+ icon files; this switches it off ----
if not exist ".nojekyll" (
    type nul > .nojekyll
    echo Created .nojekyll
)

set "TOOLS=umalator-global umalator skill-visualizer skill-visualizer-global build-planner sorter"
set "FAILED="

for %%T in (%TOOLS%) do (
    if exist "%%T\build.mjs" (
        echo Building %%T ...
        pushd "%%T"
        node build.mjs
        if errorlevel 1 set "FAILED=!FAILED! %%T"
        popd
    )
)

echo.
if "!FAILED!"=="" (
    echo All builds succeeded.
) else (
    echo BUILD FAILED for:!FAILED!
    pause
    exit /b 1
)

echo.
echo Now commit and push:
echo     git add -A
echo     git commit -m "rebuild"
echo     git push
echo.
pause
