@echo off
chcp 65001 >nul
title Kartengenerator
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo Der Kartengenerator konnte nicht gestartet werden. Bitte die Meldung oben lesen.
  pause
)
