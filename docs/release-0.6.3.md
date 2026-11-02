# PixelWall 0.6.3 — reliable update restarts

Fixed an update restart that could leave the old app open with editing locked and
the misleading message “Finish the close dialog before editing this project,”
even though no close dialog was visible.

After PixelWall has saved and verified the open documents, the native update
restart now honors that approval when the renderer raises a second unload
warning. Ordinary closes and unsuccessful saves retain their existing protection.
Failed update preparation releases the approval before editing resumes.

The regression check uses real Electron windows to confirm that an ordinary
unload warning keeps the window open and an approved update restart closes it.

Validation: 83 focused tests and the separate real Electron restart regression
passed. The full suite passed 3,445 of 3,448 tests on its initial run; all three
Lua timing failures passed in isolated reruns without code changes. Lint, the
standalone build, and the Vercel preview passed. Windows and Linux structural CI
checks passed; those packages remain unsigned and native installation was not
run on those platforms. Both Mac packages passed Developer ID signature,
notarization staple, Gatekeeper, architecture, and packaged-source checks.
The release feed and download-page checks passed all 43 tests.

Desktop packages were built from `a1b1fe268f85bd54f6287b845c569b2e3bcf7c13`.

An older version already stuck during an update must be closed once before the
downloaded update can finish. This fix takes effect after installing 0.6.3.
