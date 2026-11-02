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

An older version already stuck during an update must be closed once before the
downloaded update can finish. This fix takes effect after installing 0.6.3.
