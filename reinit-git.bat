@echo off
setlocal enabledelayedexpansion
title reinit git for uma-tools

REM Run this from INSIDE the uma-tools folder, after .git was deleted.
REM It starts a fresh repo with no history, which is all GitHub Pages needs.

cd /d "%~dp0"

if not exist "buildtools.mjs" (
    echo Run this from inside the uma-tools folder.
    pause
    exit /b 1
)

if exist ".git" (
    echo .git already exists here -- nothing to repair.
    pause
    exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
    echo Git is not installed or not on PATH.
    pause
    exit /b 1
)

REM ---- the submodule pointer is dangling now; make it a normal folder ----
if exist "uma-skill-tools\.git" (
    echo Converting uma-skill-tools from a submodule into normal files...
    del /f /q "uma-skill-tools\.git"
)
if exist ".gitmodules" del /f /q ".gitmodules"

REM ---- ignore rules ----
> .gitignore echo node_modules/
>> .gitignore echo uma-skill-tools/node_modules/
>> .gitignore echo uma-skill-tools/test/
>> .gitignore echo *.bak
>> .gitignore echo *.original.js
>> .gitignore echo *.patched.js

REM ---- Jekyll would choke on 3000+ icon files ----
if not exist ".nojekyll" type nul > .nojekyll

REM ---- sanity: the engine fix must still be in the source ----
findstr /c:"modifierScaling" "uma-skill-tools\RaceSolverBuilder.ts" >nul 2>nul
if errorlevel 1 (
    echo.
    echo   WARNING: the engine scaling fix is missing from uma-skill-tools.
    echo   Apply it before committing:  cd uma-skill-tools ^&^& git apply ..\engine-scaling-fix.patch
    echo.
    pause
)

echo.
echo Creating a fresh repository...
git init -b main
git add -A
git -c user.email="you@example.com" -c user.name="you" commit -q -m "uma-tools with custom uma ranking tab"
if errorlevel 1 (
    echo Commit failed. Set your identity first:
    echo     git config --global user.name  "Your Name"
    echo     git config --global user.email "you@example.com"
    pause
    exit /b 1
)

echo.
git count-objects -vH | findstr size-pack
echo.
echo Done. Now create an EMPTY repo on GitHub named exactly:  uma-tools
echo (the name matters -- icon paths are hardcoded to /uma-tools/)
echo.
echo Then run:
echo     git remote add origin https://github.com/YOURNAME/uma-tools.git
echo     git push -u origin main
echo.
echo Finally: Settings -^> Pages -^> Deploy from a branch -^> main -^> / (root)
echo.
pause
