# pi-theme-sync: silence OSC 11 polling on the omarchy desktop.
#
# On this host omarchy-theme-set-pi regenerates the active pi theme file
# (~/.pi/agent/themes/omarchy-system.json) on every theme flip and pi hot-reloads
# it. pi-theme-sync maps both appearances to "omarchy-system", so it must not
# probe the terminal every poll interval (garbled output risk). The gsettings
# OS fallback stays on: omarchy-theme-set-gnome flips color-scheme with the theme.
#
# Other hosts keep the defaults, so OSC 11 polling stays enabled there.
if [[ $(hostname) == werner-desktop ]]; then
  export PI_THEME_SYNC_OSC11_ENABLED=0
fi