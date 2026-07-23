!macro NSIS_HOOK_POSTINSTALL
  Delete "$SMSTARTUP\Diamond Inventory Server.lnk"
  Call CreateOrUpdateDesktopShortcut
!macroend
