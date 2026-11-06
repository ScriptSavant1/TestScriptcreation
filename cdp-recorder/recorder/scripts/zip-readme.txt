PerfX Studio - CDP Recorder
===========================

SET UP ONCE ON THIS COMPUTER

1. Right-click this ZIP and choose "Extract All...". Pick a folder that
   stays and where your computer lets you run programs, for example
   C:\PerfX\cdp-recorder - not inside your user profile folder (such as
   Downloads, Desktop or Documents). If Windows blocks the program there,
   ask your IT team.
   Do not run cdp-recorder.exe from inside the ZIP - Windows would run it
   from a temporary folder and the Start recording button could not find
   it next time.

2. Open the extracted folder and double-click cdp-recorder.exe once.
   This connects it to the "Start recording" button on the PerfX Studio
   Recorder page, for your Windows user - no administrator rights needed.
   It opens a small toolbar and a browser window - you don't need to
   record anything in them.
   If you move the folder later, double-click it again.


RECORD FROM PERFX STUDIO (recommended)

3. Open PerfX Studio -> Recorder -> Start recording. Type your
   application's address, choose Edge or Chrome and, if you like, a private
   window (optional - every recording starts signed out in a fresh browser
   profile either way), then click Start recording. The first time, your browser asks
   "Open cdp-recorder?" - click Open.

   If your computer does not let the browser start programs (an error, or
   nothing happens): start cdp-recorder.exe yourself first, then click
   Start recording on the page. The small toolbar asks "Allow this page to
   start recordings?" - click Allow. It asks once per PerfX Studio address
   and remembers it (allowed-pages.json in %LOCALAPPDATA%\PerfX\cdp-recorder).
   If Windows does not allow cdp-recorder.exe to run at all, ask your IT
   team to approve it.

4. A separate Edge (or Chrome) recording window with an orange border
   opens on your application, already recording, with a floating toolbar
   beside it. Use your application only in the recording window - new
   tabs and pop-ups it opens are recorded too; your normal browser is not.

5. Name transactions on the toolbar or on the Recorder page: type a name,
   Start Transaction, do the steps, End Transaction.

6. Click Stop and save on the page (or Stop Recording on the toolbar).
   The recording (.har file) is saved in your Downloads folder and opens
   in the Recorder by itself. The toolbar says it is saved; the recorder's
   windows close after 10 seconds - click Keep open on the toolbar to look
   at the recording window first.


OR START IT YOURSELF

Double-click cdp-recorder.exe. A floating toolbar and a separate Edge (or
Chrome) recording window with an orange border open. Use your application
only in the recording window - your normal browser is not recorded.

On the toolbar click Start Recording, type a transaction name (for example
T01_Login) and click Start Transaction. Do the steps, then click End
Transaction. Repeat for each transaction.

Click Stop Recording. The recording (.har file) is saved in the same folder
as cdp-recorder.exe. Load it in the PerfX Studio Recorder or Script Studio.
Click Quit on the toolbar when you have finished - a recording still
running is saved first.

Full guide: open PerfX Studio, click "Help & guides" in the left sidebar,
then open the Recorder section.
