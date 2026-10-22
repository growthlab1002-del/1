@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 광고 레퍼런스 보드
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js가 설치되어 있지 않습니다.
  echo  열리는 페이지에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  start "" https://nodejs.org/ko/download
  pause
  exit /b 1
)
echo  광고 레퍼런스 보드를 켭니다. 이 창을 닫으면 보드가 꺼집니다.
echo.
node collector\server.mjs --open %*
pause
