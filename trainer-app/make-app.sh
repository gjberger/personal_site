#!/bin/bash
# Builds Trainer.app (thin WKWebView shell around gabrieljberger.com/private/trainer/).
# Re-run after any change to main.m or trainer.html. The web app itself deploys with
# the site; this shell only needs rebuilding when the wrapper changes.
set -euo pipefail
cd "$(dirname "$0")"

APP=~/Applications/Trainer.app
mkdir -p ~/Applications

# icon: keep the existing one (icon.icns checked in next to this script)
if [ ! -f icon.icns ]; then
  echo "icon.icns missing next to make-app.sh" >&2; exit 1
fi

# compile the shell (Objective-C: the standalone CLT SDK breaks swiftc for GUI apps)
clang -fobjc-arc -O2 -framework Cocoa -framework WebKit -o TrainerBin main.m

# assemble the bundle
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp TrainerBin "$APP/Contents/MacOS/Trainer"
cp trainer.html "$APP/Contents/Resources/trainer.html"
cp icon.icns "$APP/Contents/Resources/icon.icns"
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Trainer</string>
  <key>CFBundleDisplayName</key><string>Trainer</string>
  <key>CFBundleIdentifier</key><string>com.gabrielberger.trainer</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundleExecutable</key><string>Trainer</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
PLIST

echo "Built $APP"
