PerfX Studio - CDP Recorder
===========================

1. Right-click this ZIP and choose "Extract All...". Pick a folder you can
   find again, for example C:\PerfX\Recorder.
   Do not run cdp-recorder.exe from inside the ZIP - Windows would run it
   from a temporary folder and your recordings would be saved there.

2. Open the extracted folder and double-click cdp-recorder.exe.
   A floating toolbar and a separate Edge (or Chrome) recording window
   with an orange border open. Use your application only in the
   recording window - your normal browser is not recorded.

3. On the toolbar click Start Recording, type a transaction name
   (for example T01_Login) and click Start Transaction. Do the steps,
   then click End Transaction. Repeat for each transaction.

4. Click Stop Recording. The recording (.har file) is saved in the same
   folder as cdp-recorder.exe. Load it in the PerfX Studio Recorder or
   Script Studio. Click Quit on the toolbar when you have finished.

Full guide: open PerfX Studio, click "Help & guides" in the left sidebar,
then open the Recorder section.
