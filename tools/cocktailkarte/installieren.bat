@echo off
chcp 65001 >nul
title Kartengenerator installieren
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installieren.ps1"
if errorlevel 1 echo Die Installation ist fehlgeschlagen. Bitte die Meldung oben lesen.
echo.
pause
