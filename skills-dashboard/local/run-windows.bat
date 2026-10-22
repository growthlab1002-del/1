@echo off
rem Double-click to start the skills dashboard (Windows).
rem The skill pack zip is found in Downloads / D:\... automatically, or you are asked for it.
chcp 65001 >nul
cd /d "%~dp0..\.."
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 skills-dashboard\local\serve.py %*
) else (
  python skills-dashboard\local\serve.py %*
)
pause
