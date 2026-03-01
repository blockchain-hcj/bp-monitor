# Alert Bar 开机自启动配置（macOS）

目标：`alert-bar` 登录后自动启动，不需要开终端；配置项放在 `.env`，后续只改配置文件即可。

## 1. 前置准备

```bash
cd /Users/haochenjing/monitors/apps/alert-bar
npm install
```

## 2. 创建配置文件（可随时修改）

```bash
cat > /Users/haochenjing/monitors/apps/alert-bar/.env <<'EOF'
ALERT_HUB_URL=http://127.0.0.1:18280
ALERT_HUB_WS_URL=ws://127.0.0.1:18280/ws
ALERT_BAR_POPUP_ON_HIGH=true
EOF
```

## 3. 创建 LaunchAgent（一次性）

```bash
NODE_BIN="$(which node)"
cat > ~/Library/LaunchAgents/com.monitors.alert-bar.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.monitors.alert-bar</string>
    <key>ProgramArguments</key>
    <array>
      <string>${NODE_BIN}</string>
      <string>--env-file-if-exists=/Users/haochenjing/monitors/apps/alert-bar/.env</string>
      <string>/Users/haochenjing/monitors/apps/alert-bar/node_modules/electron/cli.js</string>
      <string>.</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/haochenjing/monitors/apps/alert-bar</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><false/>
    <key>StandardOutPath</key><string>/tmp/alert-bar.out.log</string>
    <key>StandardErrorPath</key><string>/tmp/alert-bar.err.log</string>
  </dict>
</plist>
EOF
```

## 4. 加载并启动

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.monitors.alert-bar.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.monitors.alert-bar.plist
launchctl enable gui/$(id -u)/com.monitors.alert-bar
launchctl kickstart -k gui/$(id -u)/com.monitors.alert-bar
```

## 5. 以后改配置怎么生效

1. 修改：`/Users/haochenjing/monitors/apps/alert-bar/.env`
2. 重启进程：

```bash
launchctl kickstart -k gui/$(id -u)/com.monitors.alert-bar
```

说明：环境变量是进程启动时读取，修改 `.env` 后需要重启一次。

## 6. 常用排查命令

```bash
launchctl print gui/$(id -u)/com.monitors.alert-bar | head -n 60
tail -n 100 /tmp/alert-bar.out.log
tail -n 100 /tmp/alert-bar.err.log
```

## 7. 卸载自启动

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.monitors.alert-bar.plist
rm -f ~/Library/LaunchAgents/com.monitors.alert-bar.plist
```
