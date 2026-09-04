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
  readonly property string birthsPath: home + "/.local/state/omarchy/focusplease/births.json"

  property bool enabled: true
  property bool includeFloating: false
  property bool overcrowdEnabled: true
  property real minWidthRatio: 0.18
  property real minHeightRatio: 0.22

  property string binTimeout: "/usr/bin/timeout"
  property string binBash: "/usr/bin/bash"
  property string binHyprctl: "/usr/bin/hyprctl"
  property string binNode: ""

  property var bases: ({})
  property var births: ({})
  property var grown: null
  property string activeAddress: ""
  property var lastClients: ({})
  property var lastMonitors: ({})
  property int savedFollowMouse: 1
  property bool followMouseHeld: false
  property bool forceSuggest: false
  property bool dialogOpen: false
  property bool movingWindows: false
  property string dismissedSignature: ""
  property string pendingBirthAddress: ""
  readonly property string pluginDir: (manifest && manifest.__sourceDir)
    ? manifest.__sourceDir
    : (home + "/.config/omarchy/plugins/jose.focusplease")

  function applyConfig(raw) {
    var cfg = Model.parseConfig(raw)
    root.includeFloating = cfg.includeFloating
    root.overcrowdEnabled = cfg.overcrowd.enabled
    root.minWidthRatio = cfg.overcrowd.minWidthRatio
    root.minHeightRatio = cfg.overcrowd.minHeightRatio
    root.binTimeout = cfg.bins.timeout || "/usr/bin/timeout"
    root.binBash = cfg.bins.bash || "/usr/bin/bash"
    root.binHyprctl = cfg.bins.hyprctl || "/usr/bin/hyprctl"
    if (cfg.bins.node) root.binNode = cfg.bins.node
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
    followProc.command = [root.binTimeout, "-k", "2", "3", root.binHyprctl, "eval", "hl.config({ input = { follow_mouse = " + Number(n) + " } })"]
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

  function teardown() {
    pollTimer.running = false
    if (snapshotProc.running) snapshotProc.running = false
    if (applyProc.running) applyProc.running = false
    if (moveProc.running) moveProc.running = false
    if (captureFollowProc.running) captureFollowProc.running = false
    if (followProc.running) followProc.running = false
    if (!root.followMouseHeld) return
    root.followMouseHeld = false
    followProc.command = [root.binTimeout, "-k", "2", "3", root.binHyprctl, "eval",
      "hl.config({ input = { follow_mouse = " + Number(root.savedFollowMouse) + " } })"]
    followProc.startDetached()
  }

  function requestRefresh() {
    if (snapshotProc.running) return
    snapshotProc.running = true
  }

  function nodeCandidates() {
    var home = root.home
    return [
      home + "/.local/share/mise/shims/node",
      home + "/.local/bin/node",
      "/usr/bin/node",
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/run/current-system/sw/bin/node"
    ]
  }

  function resolveNode() {
    if (root.binNode) return
    var cmd = [root.binBash, "-c",
      'for c in "$@"; do [ -x "$c" ] && { printf "%s" "$c"; exit 0; }; done; exit 1',
      "focusplease-node"]
    var list = root.nodeCandidates()
    var i
    for (i = 0; i < list.length; i++) cmd.push(list[i])
    nodeProbe.command = cmd
    nodeProbe.running = false
    nodeProbe.running = true
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
    var bases = Model.purgeAddress(root.bases, address)
    if (bases.changed) {
      root.bases = bases.map
      root.persistBases(true)
    }
    var births = Model.purgeAddress(root.births, address)
    if (births.changed) {
      root.births = births.map
      root.persistBirths(true)
    }
  }

  function persistManual(g, cur) {
    if (!g || !cur) return
    var next = Model.mergeAxisBase(root.bases[g.key], g.expected, cur)
    if (!next) return
    var copy = {}
    var k
    for (k in root.bases) copy[k] = root.bases[k]
    copy[g.key] = next
    root.bases = copy
    root.persistBases()
  }

  function processSnapshot(text) {
    var parts = String(text || "").split("\n---S---\n")
    var clients = Model.parseClients(parts[0] || "")
    var active = Model.parseActiveWindow(parts.length > 1 ? parts[1] : "")
    var monitors = Model.parseMonitors(parts.length > 2 ? parts.slice(2).join("\n---S---\n") : "")

    root.lastClients = clients
    root.lastMonitors = monitors

    if (root.pendingBirthAddress) {
      var newborn = Model.findClient(clients, root.pendingBirthAddress)
      if (newborn) {
        var cap = Model.captureWorkspaceBirths(
          clients, root.births, newborn.workspaceId, root.includeFloating, newborn.monitor)
        if (cap.changed) {
          root.births = cap.births
          root.persistBirths()
        }
        root.pendingBirthAddress = ""
      }
    }

    var activeAddr = active && active.address ? active.address : ""
    root.activeAddress = activeAddr

    root.maybeSuggestOvercrowd(clients, clients[activeAddr] || active, monitors)

    if (applyProc.running) return

    if (root.grown && root.grown.address === activeAddr) {
      if (root.grown.settling) root.handleSettle(activeAddr, clients[activeAddr])
      else root.noteManualIfResized(clients[activeAddr])
    } else {
      if (root.grown && root.grown.address !== activeAddr) {
        if (root.grown.manual) root.persistManual(root.grown, clients[root.grown.address] || null)
        root.grown = null
      }
      if (root.enabled && activeAddr) root.handleFocus(activeAddr, clients[activeAddr] || active)
    }
  }

  function overcrowdCfg() {
    return {
      enabled: root.overcrowdEnabled,
      minWidthRatio: root.minWidthRatio,
      minHeightRatio: root.minHeightRatio
    }
  }

  function maybeSuggestOvercrowd(clients, active, monitors) {
    if (!root.enabled) return
    if (root.dialogOpen || root.movingWindows) return
    if (!root.forceSuggest && !root.overcrowdEnabled) return
    if (!active || !active.address) return
    var mon = Model.monitorForWindow(active, monitors)
    var cfg = root.overcrowdCfg()
    if (root.forceSuggest) cfg = { enabled: true, minWidthRatio: cfg.minWidthRatio, minHeightRatio: cfg.minHeightRatio }
    var plan = Model.overcrowdedPlan(clients, active, mon, root.includeFloating, cfg)
    if (!plan && root.forceSuggest) {
      var windows = Model.workspaceWindows(clients, active.workspaceId, root.includeFloating, active.monitor)
      var nextId = Model.nextWorkspace(active.workspaceId)
      if (windows.length && nextId > 0) {
        plan = {
          workspaceId: active.workspaceId,
          nextWorkspaceId: nextId,
          windows: windows,
          suggested: [],
          signature: Model.promptSignature(active.workspaceId, windows)
        }
      }
    }
    var forced = root.forceSuggest
    root.forceSuggest = false
    if (!plan) return
    if (!forced && plan.signature === root.dismissedSignature) return
    root.openMoveDialog(plan)
  }

  function openMoveDialog(plan) {
    if (!plan || root.dialogOpen) return false
    if (!root.shell || typeof root.shell.summon !== "function") return false
    var payload = {
      workspaceId: plan.workspaceId,
      nextWorkspaceId: plan.nextWorkspaceId,
      signature: plan.signature,
      suggested: plan.suggested,
      windows: Model.dialogWindows(plan.windows)
    }
    root.dialogOpen = true
    var ok = root.shell.summon("jose.focusplease", JSON.stringify(payload))
    if (!ok) root.dialogOpen = false
    return ok
  }

  function onMoveDialogOpened() {
    root.dialogOpen = true
  }

  function onMoveDialogClosed(moved, sig) {
    root.dialogOpen = false
    if (moved) root.dismissedSignature = ""
    else root.dismissedSignature = String(sig || "")
  }

  function suggestNow() {
    root.dismissedSignature = ""
    root.forceSuggest = true
    root.requestRefresh()
    return "ok"
  }

  function moveWindows(addresses, workspaceId) {
    if (!addresses || !addresses.length || !(Number(workspaceId) > 0)) return
    if (!root.binNode) return
    var cmd = [root.binTimeout, "-k", "2", "8", root.binNode, root.pluginDir + "/move.js", String(workspaceId), root.binHyprctl]
    var i
    for (i = 0; i < addresses.length; i++) cmd.push(String(addresses[i]))
    root.movingWindows = true
    root.dialogOpen = false
    moveProc.command = cmd
    moveProc.running = false
    moveProc.running = true
  }

  function handleFocus(address, meta) {
    if (!meta || !Model.isGrowable(meta, root.includeFloating)) return

    var key = Model.baseKey(meta)
    root.grown = {
      address: address,
      key: key,
      expected: { w: meta.w, h: meta.h },
      settling: false,
      manual: false
    }
    if (!Model.shouldLayout(meta, root.bases)) return
    if (!root.binNode) return
    root.grown.settling = true
    applyProc.command = [root.binTimeout, "-k", "2", "8", root.binNode, root.pluginDir + "/apply.js", address, root.includeFloating ? "1" : "0", root.binHyprctl]
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
    root.persistManual(g, cur)
    g.expected = { w: cur.w, h: cur.h }
  }

  function resetBase() {
    var cur = root.lastClients[root.activeAddress]
    if (!cur) return
    var key = Model.baseKey(cur)
    if (root.bases[key]) {
      var copy = {}
      var k
      for (k in root.bases) if (k !== key) copy[k] = root.bases[k]
      root.bases = copy
      root.persistBases(true)
    }
  }

  function resetAll() {
    root.bases = ({})
    root.births = ({})
    root.grown = null
    root.dismissedSignature = ""
    root.pendingBirthAddress = ""
    root.persistBases(true)
    root.persistBirths(true)
    return "ok"
  }

  function persistBases(allowEmpty) {
    if (!allowEmpty && Model.isEmptyMap(root.bases)) return
    var json = JSON.stringify(root.bases)
    if (!json || json === "undefined") return
    writeProc.command = [root.binTimeout, "-k", "2", "5", root.binBash, root.pluginDir + "/write-state.sh", "bases", json]
    writeProc.running = false
    writeProc.running = true
  }

  function persistBirths(allowEmpty) {
    if (!allowEmpty && Model.isEmptyMap(root.births)) return
    var json = JSON.stringify(root.births)
    if (!json || json === "undefined") return
    writeBirthsProc.command = [root.binTimeout, "-k", "2", "5", root.binBash, root.pluginDir + "/write-state.sh", "births", json]
    writeBirthsProc.running = false
    writeBirthsProc.running = true
  }

  function statusJson() {
    return JSON.stringify({
      enabled: root.enabled,
      includeFloating: root.includeFloating,
      overcrowd: root.overcrowdEnabled,
      active: root.activeAddress,
      grown: root.grown ? root.grown.address : "",
      dialogOpen: root.dialogOpen,
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
    onLoaded: {
      var merged = Model.mergeBases(text() || "{}")
      if (Model.isEmptyMap(merged) && !Model.isEmptyMap(root.bases)) return
      root.bases = merged
    }
    onLoadFailed: {}
    onFileChanged: reload()
  }

  FileView {
    path: root.birthsPath
    watchChanges: true
    printErrors: false
    onLoaded: {
      var merged = Model.mergeBases(text() || "{}")
      if (Model.isEmptyMap(merged) && !Model.isEmptyMap(root.births)) return
      root.births = merged
    }
    onLoadFailed: {}
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
    command: [root.binTimeout, "-k", "2", "5", root.binBash, "-c",
      root.binHyprctl + " -j clients; printf '\\n---S---\\n'; " + root.binHyprctl + " -j activewindow 2>/dev/null; printf '\\n---S---\\n'; " + root.binHyprctl + " -j monitors 2>/dev/null"]
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
    id: moveProc
    onExited: {
      root.movingWindows = false
      snapshotProc.running = false
      snapshotProc.running = true
    }
  }

  Process {
    id: writeProc
  }

  Process {
    id: writeBirthsProc
  }

  Process {
    id: followProc
  }

  Process {
    id: nodeProbe
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var found = String(text || "").trim()
        if (found && found.charAt(0) === "/") {
          root.binNode = found
          console.log("focusplease: node resolved to " + found)
        } else {
          console.log("focusplease: node not found, window resizing disabled")
        }
      }
    }
  }

  Process {
    id: captureFollowProc
    command: [root.binTimeout, "-k", "2", "3", root.binHyprctl, "getoption", "input:follow_mouse", "-j"]
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
        var opened = root.eventData(event)
        root.pendingBirthAddress = String(opened[0] || "")
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
    root.resolveNode()
    root.requestRefresh()
  }

  Component.onDestruction: root.teardown()

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

    function reset(): string {
      return root.resetAll()
    }

    function suggest(): string {
      return root.suggestNow()
    }

    function dismissed(sig: string): string {
      root.onMoveDialogClosed(false, sig)
      return "ok"
    }
  }
}
