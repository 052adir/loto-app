@echo off
echo ============================================
echo   Lotto Auto Deploy - Fetch, Commit, Push
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Updating lotto data...
call npm run update
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm run update failed.
    pause
    exit /b 1
)
echo.

echo [2/4] Staging all changes...
git add .
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git add failed.
    pause
    exit /b 1
)
echo.

echo [3/4] Committing...
git commit -m "Auto sync fresh lotto data"
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Nothing to commit or commit failed.
)
echo.

echo [4/4] Pushing to remote...
git push
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git push failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Done! Data updated and pushed.
echo ============================================
