@echo off
rem Thin launcher: run pack.ps1 (all real work is there; PowerShell handles UTF-8/Korean reliably).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack.ps1"
