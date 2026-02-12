#!/bin/bash

# Bruno to DevWeb Converter - Quick Installation Script
# This script installs and sets up the converter

set -e

echo "🚀 Bruno to DevWeb Converter - Installation"
echo "=========================================="
echo ""

# Check Node.js version
echo "📋 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 14.0.0"
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo "❌ Node.js version 14+ required (found: $(node -v))"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ npm $(npm -v) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"
echo ""

# Make CLI globally available
echo "🔗 Setting up global CLI command..."
npm link

if [ $? -ne 0 ]; then
    echo "⚠️  Warning: Failed to create global link. You may need sudo:"
    echo "   sudo npm link"
    echo ""
fi

echo "✅ CLI setup complete"
echo ""

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p uploads output examples/collections

echo "✅ Directories created"
echo ""

# Test installation
echo "🧪 Testing installation..."
if command -v bruno-devweb &> /dev/null; then
    bruno-devweb --version
    echo "✅ Installation test passed!"
else
    echo "⚠️  CLI command not available globally"
    echo "   You can still use: node src/cli.js"
fi

echo ""
echo "✨ Installation complete!"
echo ""
echo "📖 Quick Start:"
echo "   1. Convert a collection:"
echo "      bruno-devweb convert -i collection.json -o output/"
echo ""
echo "   2. Analyze a collection:"
echo "      bruno-devweb analyze -i collection.json"
echo ""
echo "   3. Start web UI:"
echo "      bruno-devweb web --port 3000"
echo ""
echo "📚 Documentation:"
echo "   - README.md - Overview and features"
echo "   - USER_GUIDE.md - Complete usage guide"
echo "   - TECHNICAL.md - Technical documentation"
echo ""
echo "🆘 Support:"
echo "   - Issues: https://gitlab.com/your-org/bruno-devweb-converter/issues"
echo "   - Email: support@yourorg.com"
echo ""
echo "Happy testing! 🎉"
