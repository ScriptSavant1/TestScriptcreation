# Bruno to DevWeb Converter - Windows Installation Script (PowerShell)
# This script installs and sets up the converter on Windows

# Set error handling (use Continue to not stop on non-critical errors)
$ErrorActionPreference = "Continue"

# Color functions
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$NoNewline
    )
    if ($NoNewline) {
        Write-Host $Message -ForegroundColor $Color -NoNewline
    } else {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Write-SuccessMsgMsg {
    param([string]$Message)
    Write-ColorOutput "✓ $Message" "Green"
}

function Write-ErrorMsgMsg {
    param([string]$Message)
    Write-ColorOutput "✗ $Message" "Red"
}

function Write-WarningMsgMsg {
    param([string]$Message)
    Write-ColorOutput "⚠ $Message" "Yellow"
}

function Write-InfoMsgMsg {
    param([string]$Message)
    Write-ColorOutput "ℹ $Message" "Cyan"
}

function Write-StepMsgMsg {
    param([string]$Message)
    Write-ColorOutput "▶ $Message" "Blue"
}

# Banner
Write-Host ""
Write-ColorOutput "============================================" "Cyan"
Write-ColorOutput "  Bruno to DevWeb Converter - Installation" "Cyan"
Write-ColorOutput "============================================" "Cyan"
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-WarningMsgMsg "Not running as Administrator"
    Write-InfoMsgMsg "For global CLI setup, consider running as Administrator"
    Write-Host ""
}

# Step 1: Check Node.js
Write-StepMsg "[1/6] Checking prerequisites..."
try {
    $nodeVersion = (node -v 2>$null)
    if (-not $nodeVersion) {
        throw "Node.js not found"
    }

    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($versionNumber -lt 14) {
        Write-ErrorMsg "Node.js version 14+ required (found: $nodeVersion)"
        exit 1
    }

    Write-SuccessMsg "Node.js $nodeVersion detected"
} catch {
    Write-ErrorMsg "Node.js is not installed!"
    Write-Host ""
    Write-InfoMsg "Please install Node.js >= 14.0.0 from:"
    Write-ColorOutput "https://nodejs.org/" "Yellow"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check npm
try {
    $npmVersion = (npm -v 2>$null)
    if (-not $npmVersion) {
        throw "npm not found"
    }
    Write-SuccessMsg "npm $npmVersion detected"
} catch {
    Write-ErrorMsg "npm is not installed!"
    exit 1
}
Write-Host ""

# Step 2: Install dependencies
Write-StepMsg "[2/6] Installing dependencies..."
try {
    npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed"
    }
    Write-SuccessMsg "Dependencies installed successfully"
} catch {
    Write-ErrorMsg "Failed to install dependencies!"
    Write-Host ""
    Write-InfoMsg "Try running: npm install --verbose"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Step 3: Setup global CLI
Write-StepMsg "[3/6] Setting up global CLI command..."
try {
    npm link 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "npm link failed"
    }
    Write-SuccessMsg "CLI setup complete"
} catch {
    Write-WarningMsg "Failed to create global link"
    Write-InfoMsg "You may need to run this script as Administrator"
    Write-Host ""
    Write-ColorOutput "To run as admin: Right-click PowerShell and select 'Run as administrator'" "Yellow"
    Write-ColorOutput "Then run: .\install.ps1" "Yellow"
    Write-Host ""
}
Write-Host ""

# Step 4: Create directories
Write-StepMsg "[4/6] Creating directories..."
$directories = @("uploads", "output", "examples\collections")
foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}
Write-SuccessMsg "Directories created"
Write-Host ""

# Step 5: Test installation
Write-StepMsg "[5/6] Testing installation..."
try {
    $cliVersion = (bruno-devweb --version 2>$null)
    if ($cliVersion) {
        Write-ColorOutput "  $cliVersion" "Gray"
        Write-SuccessMsg "Installation test passed!"
    } else {
        throw "CLI not found"
    }
} catch {
    Write-WarningMsg "CLI command not available globally"
    Write-InfoMsg "You can still use: node src\cli.js"
}
Write-Host ""

# Step 6: Display completion
Write-StepMsg "[6/6] Installation complete!"
Write-Host ""

Write-ColorOutput "============================================" "Green"
Write-ColorOutput "  Installation Summary" "Green"
Write-ColorOutput "============================================" "Green"
Write-Host ""
Write-ColorOutput "Status:   " "Gray" -NoNewline
Write-ColorOutput "SUCCESS" "Green"
Write-ColorOutput "Node.js:  " "Gray" -NoNewline
Write-ColorOutput "$nodeVersion" "White"
Write-ColorOutput "npm:      " "Gray" -NoNewline
Write-ColorOutput "$npmVersion" "White"
Write-ColorOutput "Location: " "Gray" -NoNewline
Write-ColorOutput "$PWD" "White"
Write-Host ""

Write-ColorOutput "============================================" "Cyan"
Write-ColorOutput "  Quick Start Guide" "Cyan"
Write-ColorOutput "============================================" "Cyan"
Write-Host ""
Write-ColorOutput "1. Convert a collection:" "Yellow"
Write-ColorOutput "   bruno-devweb convert -i collection.json -o output/" "Gray"
Write-Host ""
Write-ColorOutput "2. Analyze a collection:" "Yellow"
Write-ColorOutput "   bruno-devweb analyze -i collection.json" "Gray"
Write-Host ""
Write-ColorOutput "3. Start web UI:" "Yellow"
Write-ColorOutput "   bruno-devweb web --port 3000" "Gray"
Write-Host ""
Write-ColorOutput "4. Get help:" "Yellow"
Write-ColorOutput "   bruno-devweb --help" "Gray"
Write-Host ""

Write-ColorOutput "============================================" "Cyan"
Write-ColorOutput "  Documentation" "Cyan"
Write-ColorOutput "============================================" "Cyan"
Write-Host ""
Write-ColorOutput "  • README.md               " "Gray" -NoNewline
Write-ColorOutput "- Overview and features" "White"
Write-ColorOutput "  • RELEASE_NOTES_v2.1.0.md " "Gray" -NoNewline
Write-ColorOutput "- Latest features" "White"
Write-ColorOutput "  • USER_GUIDE.md           " "Gray" -NoNewline
Write-ColorOutput "- Complete usage guide" "White"
Write-ColorOutput "  • TECHNICAL.md            " "Gray" -NoNewline
Write-ColorOutput "- Technical documentation" "White"
Write-Host ""

Write-ColorOutput "============================================" "Cyan"
Write-ColorOutput "  Support" "Cyan"
Write-ColorOutput "============================================" "Cyan"
Write-Host ""
Write-ColorOutput "Issues: " "Gray" -NoNewline
Write-ColorOutput "https://gitlab.com/your-org/bruno-devweb-converter/issues" "Blue"
Write-Host ""
Write-ColorOutput "Happy testing! 🎉" "Green"
Write-Host ""

# Keep window open if run by double-click
if (-not $Host.UI.RawUI.KeyAvailable) {
    Read-Host "Press Enter to exit"
}
