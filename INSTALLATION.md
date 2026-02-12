# 📦 Installation Guide

Complete installation guide for **Bruno to DevWeb Converter v2.1.0** on all platforms.

---

## 🖥️ Platform-Specific Installation

### **Windows**

Choose one of the following methods:

#### **Method 1: PowerShell Script (Recommended for Windows 10/11)**

```powershell
# Open PowerShell and navigate to the project directory
cd C:\path\to\bruno-devweb-converter

# Run the PowerShell installer
.\install.ps1
```

**Features:**
- ✅ Colored output and progress indicators
- ✅ Better error handling
- ✅ Detailed status messages
- ✅ Works on Windows 10/11

**If you get "Execution Policy" error:**

```powershell
# Allow script execution (one-time setup)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then run the installer
.\install.ps1
```

---

#### **Method 2: Batch Script (Universal Windows)**

```cmd
# Open Command Prompt and navigate to the project directory
cd C:\path\to\bruno-devweb-converter

# Run the batch installer
install.bat
```

**Features:**
- ✅ Works on all Windows versions (XP, 7, 8, 10, 11)
- ✅ No PowerShell required
- ✅ Simple and reliable

---

#### **Method 3: Manual Installation (Windows)**

```cmd
# 1. Install dependencies
npm install

# 2. Create global CLI link (may require Admin privileges)
npm link

# 3. Create directories
mkdir uploads output examples\collections

# 4. Test installation
bruno-devweb --version
```

---

### **Linux / macOS**

#### **Method 1: Installation Script (Recommended)**

```bash
# Navigate to the project directory
cd /path/to/bruno-devweb-converter

# Make the script executable
chmod +x install.sh

# Run the installer
./install.sh
```

**If npm link fails:**

```bash
# Run with sudo (one-time setup)
sudo npm link
```

---

#### **Method 2: Manual Installation (Linux/macOS)**

```bash
# 1. Install dependencies
npm install

# 2. Create global CLI link
npm link
# Or with sudo if permission error:
sudo npm link

# 3. Create directories
mkdir -p uploads output examples/collections

# 4. Test installation
bruno-devweb --version
```

---

## 🚨 Troubleshooting

### **Issue 1: "npm link" fails - Permission Denied**

**Windows:**
```powershell
# Run PowerShell as Administrator
# Then execute:
npm link
```

**Linux/macOS:**
```bash
sudo npm link
```

---

### **Issue 2: "bruno-devweb" command not found**

**Solution 1: Add npm global bin to PATH**

**Windows:**
```cmd
# Find npm global bin directory
npm config get prefix

# Add to PATH:
# 1. Open System Properties → Environment Variables
# 2. Add C:\Users\<YourName>\AppData\Roaming\npm to PATH
```

**Linux/macOS:**
```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="$PATH:$(npm config get prefix)/bin"

# Reload
source ~/.bashrc  # or source ~/.zshrc
```

**Solution 2: Use without global install**

```bash
# Instead of: bruno-devweb convert -i collection.json -o output/
# Use:
node src/cli.js convert -i collection.json -o output/
```

---

### **Issue 3: Node.js version too old**

```bash
# Check current version
node -v

# If < 14.0.0, update Node.js:
# Download from: https://nodejs.org/
```

**Windows:** Download installer from [nodejs.org](https://nodejs.org/)

**Linux (using nvm):**
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node 20 (latest LTS)
nvm install 20
nvm use 20
```

**macOS (using Homebrew):**
```bash
brew install node@20
```

---

### **Issue 4: PowerShell script won't run - "Execution Policy"**

```powershell
# Check current policy
Get-ExecutionPolicy

# Change policy (choose one):
# Option 1: For current user only (recommended)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Option 2: For all users (requires Admin)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine

# Then run the script
.\install.ps1
```

---

### **Issue 5: npm install fails**

**Clear npm cache and retry:**

```bash
# Clear cache
npm cache clean --force

# Remove node_modules
rm -rf node_modules  # Linux/macOS
rmdir /s node_modules  # Windows CMD
Remove-Item -Recurse -Force node_modules  # Windows PowerShell

# Reinstall
npm install
```

---

### **Issue 6: Missing DevWebSdk.d.ts**

The installer should copy this from examples. If it fails:

**Manual fix:**
```bash
# Ensure examples directory exists
# The converter will use a fallback if original is missing
# Or manually copy from LoadRunner Enterprise DevWeb SDK
```

---

## ✅ Verify Installation

After installation, verify everything works:

```bash
# 1. Check version
bruno-devweb --version

# 2. Check help
bruno-devweb --help

# 3. Test with a sample collection (if you have one)
bruno-devweb analyze -i path/to/collection.json

# 4. Start web UI
bruno-devweb web --port 3000
# Open: http://localhost:3000
```

---

## 📋 System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | 14.0.0 | 20.x (LTS) |
| **npm** | 6.x | 10.x |
| **RAM** | 512 MB | 2 GB |
| **Disk Space** | 100 MB | 500 MB |
| **OS** | Windows 7 / Ubuntu 18.04 / macOS 10.13 | Windows 11 / Ubuntu 22.04 / macOS 13 |

---

## 🔄 Updating

### **Update to Latest Version**

```bash
# 1. Navigate to project directory
cd bruno-devweb-converter

# 2. Pull latest changes (if using git)
git pull origin main

# 3. Reinstall dependencies
npm install

# 4. Update global link
npm link

# 5. Verify
bruno-devweb --version
```

---

## 🗑️ Uninstallation

### **Windows (PowerShell/CMD)**

```cmd
# 1. Remove global CLI link
npm unlink -g bruno-devweb-converter

# 2. Delete project directory
cd ..
rmdir /s bruno-devweb-converter

# 3. (Optional) Remove from npm global
npm uninstall -g bruno-devweb-converter
```

### **Linux/macOS**

```bash
# 1. Remove global CLI link
npm unlink -g bruno-devweb-converter
# Or with sudo:
sudo npm unlink -g bruno-devweb-converter

# 2. Delete project directory
cd ..
rm -rf bruno-devweb-converter

# 3. (Optional) Remove from npm global
npm uninstall -g bruno-devweb-converter
```

---

## 🆘 Getting Help

If you encounter issues not covered here:

1. **Check the logs:**
   ```bash
   npm install --verbose  # Detailed installation logs
   ```

2. **Common logs location:**
   - Windows: `%APPDATA%\npm-cache\_logs`
   - Linux/macOS: `~/.npm/_logs`

3. **Report issues:**
   - GitHub: https://github.com/your-org/bruno-devweb-converter/issues
   - Include:
     - OS and version
     - Node.js version (`node -v`)
     - npm version (`npm -v`)
     - Error message
     - Installation log

---

## 📚 Next Steps

After successful installation:

1. 📖 Read [README.md](README.md) for overview
2. 🚀 Read [RELEASE_NOTES_v2.1.0.md](RELEASE_NOTES_v2.1.0.md) for latest features
3. 📘 Read [USER_GUIDE.md](USER_GUIDE.md) (if available) for detailed usage
4. 🧪 Try converting a sample collection

---

## 🎯 Quick Start Commands

```bash
# Convert a collection
bruno-devweb convert -i collection.json -o output/

# Analyze a collection (no conversion)
bruno-devweb analyze -i collection.json

# Start web UI
bruno-devweb web --port 3000

# Get help
bruno-devweb --help

# Show version
bruno-devweb --version
```

---

**Happy Testing! 🎉**

*Version 2.1.0 - February 2026*
