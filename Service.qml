import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "FocusPleaseModel.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string configPath: home + "/.config/omarchy/focusplease.json"
  readonly property string basesPath: home + "/.local/state/omarchy/focusplease/bases.json"

  property bool enabled: true
  property bool includeFloating: false

  property var bases: ({})
  property var grown: null
  property string activeAddress: ""
  property var lastClients: ({})
  property var lastMonitors: ({})
  property int savedFollowMouse: 1
  property bool followMouseHeld: false
  readonly property string pluginDir: (manifest && manifest.__sourceDir)
    ? manifest.__sourceDir
    : (home + "/.config/omarchy/plugins/jose.focusplease")

  function applyConfig(raw) {
    var cfg = Model.parseConfig(raw)
    root.includeFloating = cfg.includeFloating
    if (cfg.enabled !== root.enabled) {
      if (cfg.enabled) {
        root.enabled = true
        root.holdFollowMouse()
        root.requestRefresh()
      } else {
        root.enabled = false
        root.grown = null
        root.releaseFollowMouse()
      }
    }
  }

  function setEnabled(value) {
    var next = !!value
    if (next === root.enabled) return false
    root.enabled = next
    if (next) {
      root.holdFollowMouse()
      root.requestRefresh()
    } else {
      root.grown = null
      root.releaseFollowMouse()
    }
    return true
  }

  function setFollowMouse(n) {
    followProc.command = ["hyprctl", "eval", "hl.config({ input = { follow_mouse = " + Number(n) + " } })"]
    followProc.running = false
    followProc.running = true
  }

  function holdFollowMouse() {
    if (root.followMouseHeld) {
      root.setFollowMouse(0)
      return
    }
    captureFollowProc.running = false
    captureFollowProc.running = true
  }

  function releaseFollowMouse() {
    if (!root.followMouseHeld) return
    root.setFollowMouse(root.savedFollowMouse)
    root.followMouseHeld = false
  }

  function requestRefresh() {
    if (applyProc.running) return
    if (snapshotProc.running) return
    snapshotProc.running = true
  }

  function eventData(event) {
    if (event && typeof event.parse === "function") {
      try {
        var parsed = event.parse(8)
        if (Array.isArray(parsed)) return parsed
      } catch (e) {}
    }
    return String(event && event.data ? event.data : "").split(",")
  }

  function onWindowClosed(address) {
    if (!address) return
    if (root.grown && root.grown.address === address) root.grown = null
    if (root.activeAddress === address) root.activeAddress = ""
  }

  function persistManual(g, cur) {
    if (!g || !cur) return
    root.bases[g.key] = { w: cur.w, h: cur.h }
    root.persistBases()
  }

  function processSnapshot(text) {
    var parts = String(text || "").split("\n---S---\n")
    var clients = Model.parseClients(parts[0] || "")
    var active = Model.parseActiveWindow(parts.length > 1 ? parts[1] : "")
    var monitors = Model.parseMonitors(parts.length > 2 ? parts.slice(2).join("\n---S---\n") : "")

    root.lastClients = clients
    root.lastMonitors = monitors

    var activeAddr = active && active.address ? active.address : ""
    root.activeAddress = activeAddr

    if (applyProc.running) return

    if (root.grown && root.grown.address === activeAddr) {
      if (root.grown.settling) root.handleSettle(activeAddr, clients[activeAddr])
      else root.noteManualIfResized(clients[activeAddr])
      return
    }

    if (root.grown && root.grown.address !== activeAddr) {
      if (root.grown.manual) root.persistManual(root.grown, clients[root.grown.address] || null)
      root.grown = null
    }

    if (!root.enabled || !activeAddr) return

    root.handleFocus(activeAddr, clients[activeAddr] || active)
  }

  function handleFocus(address, meta) {
    if (!meta || !Model.isGrowable(meta, root.includeFloating)) return

    var key = Model.baseKey(meta)
    root.persistBases()
    root.grown = {
      address: address,
      key: key,
      expected: { w: meta.w, h: meta.h },
      settling: true,
      manual: false
    }
    applyProc.command = ["node", root.pluginDir + "/apply.js", address, root.includeFloating ? "1" : "0"]
    applyProc.running = true
  }

  function handleSettle(address, cur) {
    if (!root.grown || root.grown.address !== address || !cur) return
    root.grown.expected = { w: cur.w, h: cur.h }
    root.grown.settling = false
  }

  function noteManualIfResized(cur) {
    var g = root.grown
    if (!g || g.settling || !cur || !g.expected) return
    if (Model.sameSize(g.expected, cur, 8)) return
    g.manual = true
    g.expected = { w: cur.w, h: cur.h }
    root.persistManual(g, cur)
  }

  function resetBase() {
    var cur = root.lastClients[root.activeAddress]
    if (!cur) return
    var key = Model.baseKey(cur)
    if (root.bases[key]) {
      delete root.bases[key]
      root.persistBases()
    }
  }

  function persistBases() {
    var json = JSON.stringify(root.bases)
    writeProc.command = ["bash", "-c",
      "mkdir -p \"$HOME/.local/state/omarchy/focusplease\" && f=\"$HOME/.local/state/omarchy/focusplease/bases.json\" && printf '%s' \"$1\" > \"$f.tmp\" && mv \"$f.tmp\" \"$f\"",
      "focusplease", json]
    writeProc.running = true
  }

  function statusJson() {
    return JSON.stringify({
      enabled: root.enabled,
      includeFloating: root.includeFloating,
      active: root.activeAddress,
      grown: root.grown ? root.grown.address : "",
      bases: root.bases
    })
  }

  FileView {
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text() || "{}")
    onLoadFailed: root.applyConfig("{}")
    onFileChanged: reload()
  }

  FileView {
    path: root.basesPath
    watchChanges: true
    printErrors: false
    onLoaded: root.bases = Model.mergeBases(text() || "{}")
    onLoadFailed: root.bases = ({})
    onFileChanged: reload()
  }

  Timer {
    id: pollTimer
    interval: 500
    repeat: true
    running: root.enabled
    onTriggered: root.requestRefresh()
  }

  Process {
    id: snapshotProc
    command: ["bash", "-c",
      "hyprctl -j clients; printf '\\n---S---\\n'; hyprctl -j activewindow 2>/dev/null; printf '\\n---S---\\n'; hyprctl -j monitors 2>/dev/null"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.processSnapshot(text)
    }
  }

  Process {
    id: applyProc
    onExited: {
      snapshotProc.running = false
      snapshotProc.running = true
    }
  }

  Process {
    id: writeProc
  }

  Process {
    id: followProc
  }

  Process {
    id: captureFollowProc
    command: ["hyprctl", "getoption", "input:follow_mouse", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var opt = Model.parseJson(text, {})
        var n = Number(opt && opt.int)
        if (isFinite(n)) root.savedFollowMouse = n
        root.followMouseHeld = true
        root.setFollowMouse(0)
      }
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event && event.name ? event.name : "")
      if (name === "activewindowv2" || name === "activewindow") {
        root.requestRefresh()
      } else if (name === "openwindow") {
        root.grown = null
        root.requestRefresh()
      } else if (name === "closewindow") {
        var parts = root.eventData(event)
        root.onWindowClosed(String(parts[0] || ""))
      }
    }
  }

  Component.onCompleted: {
    console.log("focusplease service ready")
    if (root.enabled) root.holdFollowMouse()
    root.requestRefresh()
  }

  Component.onDestruction: root.releaseFollowMouse()

  IpcHandler {
    target: "focusplease"

    function enable(): string {
      root.setEnabled(true)
      return "enabled"
    }

    function disable(): string {
      root.setEnabled(false)
      return "disabled"
    }

    function toggle(): string {
      root.setEnabled(!root.enabled)
      return root.enabled ? "enabled" : "disabled"
    }

    function status(): string {
      return root.statusJson()
    }

    function ping(): string { return "ok" }

    function resetBase(): string {
      root.resetBase()
      return "ok"
    }
  }
}
