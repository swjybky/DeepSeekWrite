@echo off
chcp 65001 >nul
echo.
echo Reset / 重置 DeepseekWrite runtime...
echo (Clears corrupted WebView2 cache. Your books and materials are safe.)
echo （清理可能损坏的 WebView2 缓存，不会影响你的书籍与素材数据。）
echo.
if exist "%APPDATA%\WriteClaw\WebViewData" (
    rmdir /s /q "%APPDATA%\WriteClaw\WebViewData"
    echo Done / 已清理 WebView2 缓存目录。
) else (
    echo No cache folder found / 未发现缓存目录，将直接启动。
)
echo.
echo Starting / 正在启动 DeepseekWrite...
start "" "%~dp0deepseekwrite.exe"
exit
