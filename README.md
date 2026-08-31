# FocusPlease

Give the focused window its configured pixel size on [Omarchy](https://omarchy.org) Quattro (Hyprland + omarchy-shell). Nested splits borrow space from other columns so a window in a split row can still claim its size.

Supporting Omarchy from El Salvador, Central America! I hope this plugin is useful for everyone. Greetings, Jose.

## What it does

Each tiled window remembers the size it had when you last resized it (**pixels**,
not a percentage of the screen). On focus it **claims that size**. The other
windows shrink so it fits, **in proportion to their own configured sizes**.
Windows you never resized share the leftover equally.

Columns, stacked windows, and nested splits are handled together: if the
focused window sits in a split inside a column, that column grows by taking
space from the other columns so siblings are not the only ones that shrink.

Examples on a 1920px-wide row:

- A configured 1000px, B unconfigured → focus A: A=1000, B=920. Focus B (also
  1000px): they swap.
- B configured 1200px → focus B: B=1200, A=720.
- Three unconfigured windows → 640px each. Give A 1000px → B and C split the
  remaining 920px (460 each).

| Behavior | How |
|---|---|
| Claim configured size | automatic, on focus |
| Set a window's focused size | resize it with Omarchy's normal resize keys |
| Forget a window's size | `omarchy-shell focusplease resetBase` |
| Toggle | `Super + Z` |

While enabled, focus-follows-mouse is off (click or keyboard only), so hovering
does not trigger a relayout. Disabling the plugin restores Hyprland's previous
`follow_mouse` setting.

## Install

```bash
omarchy plugin add https://github.com/VisorDTE/FocusPlease.git --enable
```

Then add a bind in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + Z", "Toggle focus magnify",
  "omarchy-shell focusplease toggle")
```

Reload Hyprland (`hyprctl reload`).

## Configure

Optional file: `~/.config/omarchy/focusplease.json` (hot-reloads on save):

```json
{
  "enabled": true,
  "includeFloating": false
}
```

Per-window focused sizes live in
`~/.local/state/omarchy/focusplease/bases.json` and are written when you
resize a focused window.

## Commands

```bash
omarchy-shell focusplease toggle
omarchy-shell focusplease enable
omarchy-shell focusplease disable
omarchy-shell focusplease status
omarchy-shell focusplease resetBase
```

## Remove

```bash
omarchy plugin remove jose.focusplease
```

## Develop

```bash
cd ~/source/FocusPlease
npm test
omarchy plugin validate .
```

Requires Omarchy Quattro 4.0.1+ (Hyprland 0.56 Lua dispatchers). Stack: Omarchy
shell `service` plugin (Quickshell), `hyprctl`, Node `node --test`.

## License

MIT. See [LICENSE](LICENSE).
