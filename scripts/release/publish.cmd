@echo off
chcp 65001 >nul
rem 发布入口（已入库）：双击或在命令行运行都可以。真正的逻辑见同目录 publish.mjs。
rem 参数原样透传，例如：publish.cmd --no-push / --no-icon
cd /d "%~dp0..\.."
node "%~dp0publish.mjs" %*
echo.
pause
