@echo off
chcp 65001 >nul
echo ================================================
echo   SillyTavern-AutoPlotEngine 一键上传到GitHub
echo ================================================
echo.

cd /d "%~dp0"

REM 检查是否已经初始化git
if not exist ".git" (
    echo [1/6] 初始化Git仓库...
    git init
    echo.
    
    echo [2/6] 添加远程仓库...
    git remote add origin https://github.com/cnfh1746/SillyTavern-AutoPlotEngine.git
    echo.
) else (
    echo [1/6] Git仓库已存在，跳过初始化
    echo.
    
    REM 检查远程仓库是否正确
    git remote get-url origin >nul 2>&1
    if errorlevel 1 (
        echo [2/6] 添加远程仓库...
        git remote add origin https://github.com/cnfh1746/SillyTavern-AutoPlotEngine.git
        echo.
    ) else (
        echo [2/6] 远程仓库已配置
        echo.
    )
)

echo [3/6] 添加所有文件...
git add .
echo.

echo [4/6] 提交更改...
set /p commit_msg="请输入提交信息 (直接回车使用默认): "
if "%commit_msg%"=="" set commit_msg=更新代码
git commit -m "%commit_msg%"
echo.

echo [5/6] 推送到GitHub...
git branch -M main
git push -u origin main --force
echo.

echo [6/6] 完成！
echo.
echo ================================================
echo   代码已成功上传到:
echo   https://github.com/cnfh1746/SillyTavern-AutoPlotEngine
echo ================================================
echo.
pause
