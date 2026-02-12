@echo off
REM Bruno to DevWeb Converter - Windows Installation Script (Batch)
REM This script installs and sets up the converter on Windows

setlocal enabledelayedexpansion

echo.
echo ============================================
echo   Bruno to DevWeb Converter - Installation
echo ============================================
echo.

REM Check Node.js installation
echo [1/6] Checking prerequisites...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js ^>= 14.0.0 from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check Node.js version
for /f "tokens=1" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js %NODE_VERSION% detected

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed!
    pause
    exit /b 1
)

for /f "tokens=1" %%v in ('npm -v') do set NPM_VERSION=%%v
echo [OK] npm %NPM_VERSION% detected
echo.

REM Install dependencies
echo [2/6] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)
echo [OK] Dependencies installed successfully
echo.

REM Setup global CLI command
echo [3/6] Setting up global CLI command...
call npm link
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Failed to create global link.
    echo You may need to run this script as Administrator.
    echo.
    echo To run as admin: Right-click install.bat and select "Run as administrator"
    echo.
) else (
    echo [OK] CLI setup complete
)
echo.

REM Create necessary directories
echo [4/6] Creating directories...
if not exist "uploads" mkdir uploads
if not exist "output" mkdir output
if not exist "examples\collections" mkdir examples\collections
echo [OK] Directories created
echo.

REM Test installation
echo [5/6] Testing installation...
where bruno-devweb >nul 2>&1
if %ERRORLEVEL% equ 0 (
    call bruno-devweb --version
    echo [OK] Installation test passed!
) else (
    echo [WARNING] CLI command not available globally
    echo You can still use: node src\cli.js
)
echo.

REM Display completion message
echo [6/6] Installation complete!
echo.
echo ============================================
echo   Installation Summary
echo ============================================
echo.
echo Status: SUCCESS
echo Node.js: %NODE_VERSION%
echo npm: %NPM_VERSION%
echo Location: %CD%
echo.
echo ============================================
echo   Quick Start Guide
echo ============================================
echo.
echo 1. Convert a collection:
echo    bruno-devweb convert -i collection.json -o output/
echo.
echo 2. Analyze a collection:
echo    bruno-devweb analyze -i collection.json
echo.
echo 3. Start web UI:
echo    bruno-devweb web --port 3000
echo.
echo 4. Get help:
echo    bruno-devweb --help
echo.
echo ============================================
echo   Documentation
echo ============================================
echo.
echo - README.md           - Overview and features
echo - RELEASE_NOTES_v2.1.0.md - Latest features
echo - USER_GUIDE.md       - Complete usage guide
echo - TECHNICAL.md        - Technical documentation
echo.
echo ============================================
echo   Support
echo ============================================
echo.
echo Issues: https://gitlab.com/your-org/bruno-devweb-converter/issues
echo.
echo Happy testing! [32m*[0m
echo.
pause
