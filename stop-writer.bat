@echo off
rem Stops the Ayodhyya Writer local server started by start-writer.bat.
taskkill /FI "WINDOWTITLE eq Ayodhyya Writer server*" >nul 2>nul
if errorlevel 1 (
  echo No Ayodhyya Writer server window found.
) else (
  echo Ayodhyya Writer server stopped.
)
