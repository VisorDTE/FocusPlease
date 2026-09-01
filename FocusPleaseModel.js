function parseJson(raw, fallback) {
  try {
    return JSON.parse(String(raw || ""))
  } catch (e) {
    return fallback
  }
}

function numberOr(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

function clampRatio(value, fallback) {
  var n = numberOr(value, fallback)
  if (!(n > 0) || n > 0.5) return fallback
  return n
}

function parseConfig(fileRaw) {
  var file = parseJson(fileRaw, {})
  if (!file || typeof file !== "object" || Array.isArray(file)) file = {}
  var oc = file.overcrowd
  if (!oc || typeof oc !== "object" || Array.isArray(oc)) oc = {}
  return {
    enabled: file.enabled !== false,
    includeFloating: !!file.includeFloating,
    overcrowd: {
      enabled: oc.enabled !== false,
      minWidthRatio: clampRatio(oc.minWidthRatio, 0.18),
      minHeightRatio: clampRatio(oc.minHeightRatio, 0.22)
    }
  }
}

function windowMeta(c) {
  if (!c || typeof c !== "object") return null
  var size = Array.isArray(c.size) ? c.size : []
  var at = Array.isArray(c.at) ? c.at : []
  var ws = c.workspace
  var workspaceId = (ws && typeof ws === "object") ? (ws.id !== undefined ? ws.id : ws.name) : undefined
  return {
    address: String(c.address || ""),
    cls: String(c.class || c.initialClass || ""),
    title: String(c.title || ""),
    w: numberOr(size[0], 0),
    h: numberOr(size[1], 0),
    x: numberOr(at[0], 0),
    y: numberOr(at[1], 0),
    workspaceId: workspaceId,
    floating: !!c.floating,
    fullscreen: numberOr(c.fullscreen, 0) > 0,
    pinned: !!c.pinned,
    mapped: c.mapped !== false,
    monitor: numberOr(c.monitor, -1)
  }
}

function parseClients(raw) {
  var arr = parseJson(raw, [])
  if (!Array.isArray(arr)) arr = []
  var byAddress = {}
  for (var i = 0; i < arr.length; i++) {
    var meta = windowMeta(arr[i])
    if (meta && meta.address) byAddress[meta.address] = meta
  }
  return byAddress
}

function parseActiveWindow(raw) {
  return windowMeta(parseJson(raw, null))
}

function monitorMeta(m) {
  if (!m || typeof m !== "object") return null
  var scale = numberOr(m.scale, 1)
  if (!(scale > 0)) scale = 1
  var reserved = Array.isArray(m.reserved) ? m.reserved : []
  var rLeft = numberOr(reserved[0], 0)
  var rTop = numberOr(reserved[1], 0)
  var rRight = numberOr(reserved[2], 0)
  var rBottom = numberOr(reserved[3], 0)
  var x = (numberOr(m.x, 0) + rLeft) / scale
  var y = (numberOr(m.y, 0) + rTop) / scale
  return {
    id: numberOr(m.id, -1),
    width: numberOr(m.width, 0),
    height: numberOr(m.height, 0),
    scale: scale,
    focused: !!m.focused,
    wa: {
      x: x,
      y: y,
      w: (numberOr(m.width, 0) - rLeft - rRight) / scale,
      h: (numberOr(m.height, 0) - rTop - rBottom) / scale
    }
  }
}

function parseMonitors(raw) {
  var arr = parseJson(raw, [])
  if (!Array.isArray(arr)) arr = []
  var byId = {}
  for (var i = 0; i < arr.length; i++) {
    var meta = monitorMeta(arr[i])
    if (meta) byId[meta.id] = meta
  }
  return byId
}

function monitorForWindow(win, monitors) {
  if (!win || win.monitor === undefined || win.monitor === null) return null
  return monitors[numberOr(win.monitor, -1)] || null
}

function isGrowable(win, includeFloating) {
  if (!win || !win.address || !win.mapped) return false
  if (win.fullscreen) return false
  if (win.pinned) return false
  if (!includeFloating && win.floating) return false
  if (!(win.w > 0) || !(win.h > 0)) return false
  return true
}

function classKey(win) {
  var ws = win.workspaceId === undefined ? "" : String(win.workspaceId)
  return "ws" + ws + "::" + (win.cls || "?")
}

function baseKey(win) {
  return classKey(win) + "::" + String(win.address || "")
}

function lookupBase(win, bases) {
  if (!bases || !win) return null
  return bases[baseKey(win)] || bases[classKey(win)] || null
}

function addressFromKey(key) {
  var s = String(key || "")
  var i = s.lastIndexOf("::")
  if (i < 0) return ""
  var addr = s.slice(i + 2)
  if (/^0x[0-9a-f]+$/i.test(addr)) return addr
  return ""
}

function sameAddress(a, b) {
  var x = String(a || "").toLowerCase()
  var y = String(b || "").toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  if (x.indexOf("0x") === 0) x = x.slice(2)
  if (y.indexOf("0x") === 0) y = y.slice(2)
  return x === y && x.length > 0
}

function purgeAddress(map, address) {
  var src = map && typeof map === "object" ? map : {}
  var out = {}
  var changed = false
  var k
  for (k in src) {
    if (sameAddress(addressFromKey(k), address)) {
      changed = true
      continue
    }
    out[k] = src[k]
  }
  return { map: out, changed: changed }
}

function isEmptyMap(map) {
  if (!map || typeof map !== "object") return true
  var k
  for (k in map) if (map[k]) return false
  return true
}

function pruneOrphans(map, byAddress) {
  var live = {}
  var list = clientsList(byAddress)
  if (!list.length) return { map: map && typeof map === "object" ? map : {}, changed: false }
  var i
  for (i = 0; i < list.length; i++) live[String(list[i].address || "").toLowerCase()] = true
  var src = map && typeof map === "object" ? map : {}
  var out = {}
  var changed = false
  var k
  for (k in src) {
    var addr = addressFromKey(k)
    if (addr && !live[addr.toLowerCase()]) {
      changed = true
      continue
    }
    out[k] = src[k]
  }
  return { map: out, changed: changed }
}

function overlayBirths(user, births) {
  var out = {}
  var k
  if (births && typeof births === "object") {
    for (k in births) if (births[k]) out[k] = births[k]
  }
  if (user && typeof user === "object") {
    for (k in user) if (user[k]) out[k] = user[k]
  }
  return out
}

function overlayDemand(user, births, focused) {
  var out = {}
  if (!focused || !user || typeof user !== "object") return out
  var uk = user[baseKey(focused)] || user[classKey(focused)]
  if (uk) out[baseKey(focused)] = uk
  return out
}

function shouldLayout(focused, user) {
  return !!(focused && lookupBase(focused, user))
}

function captureBirths(byAddress, births, includeFloating) {
  var out = {}
  var k
  if (births && typeof births === "object") {
    for (k in births) {
      var b = births[k]
      if (b && b.w > 0 && b.h > 0) out[k] = { w: b.w, h: b.h }
    }
  }
  var changed = false
  var list = clientsList(byAddress)
  var i
  for (i = 0; i < list.length; i++) {
    var w = list[i]
    if (!isGrowable(w, includeFloating)) continue
    var key = baseKey(w)
    if (out[key]) continue
    if (!(w.w > 0) || !(w.h > 0)) continue
    out[key] = { w: w.w, h: w.h }
    changed = true
  }
  return { births: out, changed: changed }
}

function findClient(byAddress, address) {
  if (!byAddress || !address) return null
  if (byAddress[address]) return byAddress[address]
  var list = clientsList(byAddress)
  var i
  for (i = 0; i < list.length; i++) {
    if (sameAddress(list[i].address, address)) return list[i]
  }
  return null
}

function captureOneBirth(win, births) {
  var out = {}
  var k
  if (births && typeof births === "object") {
    for (k in births) {
      var b = births[k]
      if (b && b.w > 0 && b.h > 0) out[k] = { w: b.w, h: b.h }
    }
  }
  if (!win || !win.address) return { births: out, changed: false }
  var key = baseKey(win)
  if (out[key]) return { births: out, changed: false }
  if (!(win.w > 0) || !(win.h > 0)) return { births: out, changed: false }
  out[key] = { w: win.w, h: win.h }
  return { births: out, changed: true }
}

function captureWorkspaceBirths(byAddress, births, workspaceId, includeFloating, monitorId) {
  var windows = workspaceWindows(byAddress, workspaceId, includeFloating, monitorId)
  var out = births
  var changed = false
  if (!windows || windows.length < 2) {
    var empty = captureOneBirth(null, births)
    return { births: empty.births, changed: false }
  }
  var i
  for (i = 0; i < windows.length; i++) {
    var cap = captureOneBirth(windows[i], out)
    out = cap.births
    if (cap.changed) changed = true
  }
  return { births: out, changed: changed }
}

function edgeSigns(win, mon) {
  var tol = 20
  var wa = mon && mon.wa && mon.wa.w > 0 && mon.wa.h > 0 ? mon.wa : null

  var leftSticks = false
  var rightSticks = false
  var topSticks = false
  var bottomSticks = false
  if (wa) {
    leftSticks = win.x <= wa.x + tol
    rightSticks = win.x + win.w >= wa.x + wa.w - tol
    topSticks = win.y <= wa.y + tol
    bottomSticks = win.y + win.h >= wa.y + wa.h - tol
  }

  var sx = 1
  if (leftSticks && rightSticks) sx = 0
  else if (rightSticks && !leftSticks) sx = -1

  var sy = 1
  if (topSticks && bottomSticks) sy = 0
  else if (bottomSticks && !topSticks) sy = -1

  return { sx: sx, sy: sy }
}

function yInterior(win, mon) {
  var tol = 20
  var wa = mon && mon.wa && mon.wa.w > 0 && mon.wa.h > 0 ? mon.wa : null
  if (!wa || !win) return false
  var top = win.y <= wa.y + tol
  var bot = win.y + win.h >= wa.y + wa.h - tol
  return !top && !bot
}

function deltaToTarget(win, mon, target) {
  var signs = edgeSigns(win, mon)
  return {
    x: signs.sx === 0 ? 0 : (target.w - win.w) * signs.sx,
    y: signs.sy === 0 ? 0 : (target.h - win.h) * signs.sy
  }
}

function sameSize(a, b, tolerance) {
  tolerance = tolerance === undefined ? 4 : tolerance
  if (!a || !b) return false
  return Math.abs(a.w - b.w) <= tolerance && Math.abs(a.h - b.h) <= tolerance
}

function mergeBases(persistedRaw) {
  var parsed = parseJson(persistedRaw, {})
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {}
  var out = {}
  for (var key in parsed) {
    var b = parsed[key]
    if (!b || typeof b !== "object") continue
    var w = numberOr(b.w, 0)
    var h = numberOr(b.h, 0)
    if (w > 0 || h > 0) {
      out[key] = {}
      if (w > 0) out[key].w = w
      if (h > 0) out[key].h = h
    }
  }
  return out
}

function mergeAxisBase(prev, expected, cur, noise) {
  noise = noise === undefined ? 40 : noise
  var next = {}
  if (prev && numberOr(prev.w, 0) > 0) next.w = prev.w
  if (prev && numberOr(prev.h, 0) > 0) next.h = prev.h
  if (!expected || !cur) return (next.w > 0 || next.h > 0) ? next : null
  if (Math.abs(cur.w - expected.w) > noise) {
    if (!(next.w > 0) || Math.abs(cur.w - next.w) > noise) next.w = cur.w
  }
  if (Math.abs(cur.h - expected.h) > noise) {
    if (!(next.h > 0) || Math.abs(cur.h - next.h) > noise) next.h = cur.h
  }
  if (!(next.w > 0) && !(next.h > 0)) return null
  return next
}

function hasPeerAlong(win, windows, axis, minSize) {
  if (!win || !windows) return false
  minSize = minSize || 80
  var i
  for (i = 0; i < windows.length; i++) {
    var o = windows[i]
    if (!o || o.address === win.address) continue
    if (axis === "x") {
      if (overlapAmount(win.y, win.y + win.h, o.y, o.y + o.h) > 24 && o.w >= minSize) return true
    } else if (overlapAmount(win.x, win.x + win.w, o.x, o.x + o.w) > 24 && o.h >= minSize) return true
  }
  return false
}

function claimAxes(focused, bases, windows, mon) {
  var b = lookupBase(focused, bases)
  var x = !!(b && numberOr(b.w, 0) > 0)
  var y = !!(b && numberOr(b.h, 0) > 0)
  var waW = mon && mon.wa && mon.wa.w > 0 ? mon.wa.w : 1920
  var waH = mon && mon.wa && mon.wa.h > 0 ? mon.wa.h : 1080
  var minX = Math.max(minDim(mon, "x"), Math.round(waW * 0.12))
  var minY = Math.max(minDim(mon, "y"), Math.round(waH * 0.12))
  if (x && !hasPeerAlong(focused, windows, "x", minX)) x = false
  if (y && !hasPeerAlong(focused, windows, "y", minY)) y = false
  return { x: x, y: y }
}

function resizeCommand(address, dx, dy) {
  var selector = "address:" + String(address)
  return 'hl.dsp.window.resize({ window = "' + selector + '", x = ' + Math.round(dx) + ', y = ' + Math.round(dy) + ', relative = true })'
}

function clientsList(byAddress) {
  var out = []
  if (!byAddress || typeof byAddress !== "object") return out
  for (var addr in byAddress) {
    if (byAddress[addr]) out.push(byAddress[addr])
  }
  return out
}

function minDim(mon, axis) {
  var wa = mon && mon.wa ? (axis === "y" ? mon.wa.h : mon.wa.w) : 0
  if (!(wa > 0)) wa = axis === "y" ? 1080 : 1920
  return Math.max(80, Math.round(wa * 0.08))
}

function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2
}

function overlapAmount(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1)
}

function tiledSiblings(win, byAddress, includeFloating) {
  var out = []
  var list = clientsList(byAddress)
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!o || o.address === win.address) continue
    if (!isGrowable(o, includeFloating)) continue
    if (String(o.workspaceId) !== String(win.workspaceId)) continue
    out.push(o)
  }
  return out
}

function clusterStrips(windows, axis) {
  var strips = []
  var i, h
  for (i = 0; i < windows.length; i++) {
    var w = windows[i]
    var a1 = axis === "x" ? w.x : w.y
    var a2 = a1 + (axis === "x" ? w.w : w.h)
    var hits = []
    for (var s = 0; s < strips.length; s++) {
      if (overlapAmount(a1, a2, strips[s].a1, strips[s].a2) > 24) hits.push(s)
    }
    if (!hits.length) {
      strips.push({ a1: a1, a2: a2, windows: [w] })
      continue
    }
    var keep = hits[0]
    strips[keep].windows.push(w)
    strips[keep].a1 = Math.min(strips[keep].a1, a1)
    strips[keep].a2 = Math.max(strips[keep].a2, a2)
    for (h = hits.length - 1; h >= 1; h--) {
      var other = strips[hits[h]]
      strips[keep].windows = strips[keep].windows.concat(other.windows)
      strips[keep].a1 = Math.min(strips[keep].a1, other.a1)
      strips[keep].a2 = Math.max(strips[keep].a2, other.a2)
      strips.splice(hits[h], 1)
    }
  }
  strips.sort(function (a, b) { return a.a1 - b.a1 })
  return strips
}

function stripRep(strip, focused, axis) {
  var list = strip.windows
  var rep = list[0]
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i].address === focused.address) {
      rep = list[i]
      break
    }
  }
  var clone = {}
  for (var k in rep) clone[k] = rep[k]
  if (axis === "x") {
    clone.x = strip.a1
    clone.w = Math.max(1, Math.round(strip.a2 - strip.a1))
  } else {
    clone.y = strip.a1
    clone.h = Math.max(1, Math.round(strip.a2 - strip.a1))
  }
  return clone
}

function groupAlong(win, byAddress, includeFloating, axis) {
  var all = [win].concat(tiledSiblings(win, byAddress, includeFloating))
  var pool = all
  if (axis === "y") {
    pool = []
    for (var i = 0; i < all.length; i++) {
      if (overlaps(win.x, win.x + win.w, all[i].x, all[i].x + all[i].w)) pool.push(all[i])
    }
  }
  var strips = clusterStrips(pool, axis)
  var group = []
  for (var s = 0; s < strips.length; s++) group.push(stripRep(strips[s], win, axis))
  return group
}

function configuredDim(win, bases, available, n, axis) {
  var b = lookupBase(win, bases)
  var v = b ? numberOr(axis === "x" ? b.w : b.h, 0) : 0
  if (v > 0) return v
  return n > 0 ? available / n : available
}

function shareRemainder(weights, remainder, minSize) {
  var n = weights.length
  var out = []
  if (n === 0) return out
  var sum = 0
  var i
  for (i = 0; i < n; i++) sum += weights[i]
  if (!(sum > 0)) {
    weights = []
    for (i = 0; i < n; i++) weights.push(1)
    sum = n
  }
  var used = 0
  for (i = 0; i < n; i++) {
    var s = Math.round(remainder * weights[i] / sum)
    out.push(s)
    used += s
  }
  out[n - 1] += remainder - used

  for (i = 0; i < n; i++) {
    if (out[i] >= minSize) continue
    var need = minSize - out[i]
    out[i] = minSize
    for (var t = 0; t < n && need > 0; t++) {
      if (t === i) continue
      var give = out[t] - minSize
      if (give <= 0) continue
      var take = Math.min(give, need)
      out[t] -= take
      need -= take
    }
  }
  return out
}

function axisTargets(focused, group, bases, mon, axis) {
  var n = group.length
  var available = 0
  var i
  for (i = 0; i < n; i++) available += axis === "x" ? group[i].w : group[i].h
  if (n < 2 || !(available > 0)) return {}

  var minSize = minDim(mon, axis)
  var focusedCfg = configuredDim(focused, bases, available, n, axis)
  var focusedTarget = Math.round(Math.min(focusedCfg, available - (n - 1) * minSize))
  if (focusedTarget < minSize) focusedTarget = minSize

  var remainder = available - focusedTarget
  var unfocused = []
  var weights = []
  for (i = 0; i < n; i++) {
    if (group[i].address === focused.address) continue
    unfocused.push(group[i])
    weights.push(configuredDim(group[i], bases, available, n, axis))
  }
  var shares = shareRemainder(weights, remainder, minSize)
  var targets = {}
  targets[focused.address] = focusedTarget
  for (i = 0; i < unfocused.length; i++) targets[unfocused[i].address] = shares[i]
  return targets
}

function partition(windows, axis) {
  if (!windows || windows.length < 2) return null
  var strips = clusterStrips(windows, axis)
  if (strips.length < 2) return null
  var groups = []
  var i
  for (i = 0; i < strips.length; i++) groups.push(strips[i].windows)
  return groups
}

function buildTree(windows) {
  if (!windows || windows.length === 0) return null
  if (windows.length === 1) return { type: "leaf", win: windows[0] }
  var vg = partition(windows, "x")
  if (vg) {
    var vchildren = []
    var vi
    for (vi = 0; vi < vg.length; vi++) vchildren.push(buildTree(vg[vi]))
    return { type: "v", children: vchildren }
  }
  var hg = partition(windows, "y")
  if (hg) {
    var hchildren = []
    var hi
    for (hi = 0; hi < hg.length; hi++) hchildren.push(buildTree(hg[hi]))
    return { type: "h", children: hchildren }
  }
  var sorted = windows.slice().sort(function (p, q) { return p.x - q.x })
  var mid = Math.max(1, Math.floor(sorted.length / 2))
  return { type: "v", children: [buildTree(sorted.slice(0, mid)), buildTree(sorted.slice(mid))] }
}

function nodeChildren(node) {
  if (!node || node.type === "leaf") return []
  if (node.children) return node.children
  var out = []
  if (node.a) out.push(node.a)
  if (node.b) out.push(node.b)
  return out
}

function treeContains(node, addr) {
  if (!node) return false
  if (node.type === "leaf") return node.win.address === addr
  var kids = nodeChildren(node)
  var i
  for (i = 0; i < kids.length; i++) {
    if (treeContains(kids[i], addr)) return true
  }
  return false
}

function subtreeWeight(node, bases, axis) {
  if (!node) return 0
  if (node.type === "leaf") {
    var b = lookupBase(node.win, bases)
    var v = b ? numberOr(axis === "x" ? b.w : b.h, 0) : 0
    if (v > 0) return v
    return axis === "x" ? node.win.w : node.win.h
  }
  var kids = nodeChildren(node)
  var i
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y")) {
    var mx = 0
    for (i = 0; i < kids.length; i++) {
      var wv = subtreeWeight(kids[i], bases, axis)
      if (wv > mx) mx = wv
    }
    return mx
  }
  var sum = 0
  for (i = 0; i < kids.length; i++) sum += subtreeWeight(kids[i], bases, axis)
  return sum
}

function focusedDemand(node, focusedAddr, bases, axis) {
  if (!node) return 0
  if (node.type === "leaf") {
    if (node.win.address !== focusedAddr) return 0
    var b = lookupBase(node.win, bases)
    var v = b ? numberOr(axis === "x" ? b.w : b.h, 0) : 0
    if (v > 0) return v
    return axis === "x" ? node.win.w : node.win.h
  }
  var kids = nodeChildren(node)
  var i
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y")) {
    var mx = 0
    for (i = 0; i < kids.length; i++) {
      var d = focusedDemand(kids[i], focusedAddr, bases, axis)
      if (d > mx) mx = d
    }
    return mx
  }
  var sum = 0
  for (i = 0; i < kids.length; i++) sum += focusedDemand(kids[i], focusedAddr, bases, axis)
  return sum
}

function leafCount(node) {
  if (!node) return 0
  if (node.type === "leaf") return 1
  var kids = nodeChildren(node)
  var n = 0
  var i
  for (i = 0; i < kids.length; i++) n += leafCount(kids[i])
  return n
}

function unfocusedWeight(node, focusedAddr, bases, axis) {
  if (!node) return 0
  if (node.type === "leaf") {
    if (node.win.address === focusedAddr) return 0
    return subtreeWeight(node, bases, axis)
  }
  var kids = nodeChildren(node)
  var i
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y")) {
    for (i = 0; i < kids.length; i++) {
      if (treeContains(kids[i], focusedAddr)) return unfocusedWeight(kids[i], focusedAddr, bases, axis)
    }
    var mx = 0
    for (i = 0; i < kids.length; i++) {
      var u = unfocusedWeight(kids[i], focusedAddr, bases, axis)
      if (u > mx) mx = u
    }
    return mx
  }
  var sum = 0
  for (i = 0; i < kids.length; i++) sum += unfocusedWeight(kids[i], focusedAddr, bases, axis)
  return sum
}

function fillTree(node, box, focusedAddr, bases, mon, out) {
  if (!node) return
  if (node.type === "leaf") {
    out[node.win.address] = { w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) }
    return
  }
  var kids = nodeChildren(node)
  var axis = node.type === "v" ? "x" : "y"
  var total = axis === "x" ? box.w : box.h
  var minS = minDim(mon, axis)
  var n = kids.length
  var fi = -1
  var i
  for (i = 0; i < n; i++) {
    if (treeContains(kids[i], focusedAddr)) fi = i
  }
  var sizesAlong = []
  var minNeed = []
  for (i = 0; i < n; i++) minNeed.push(minS * Math.max(1, leafCount(kids[i])))
  if (fi >= 0) {
    var fd = focusedDemand(kids[fi], focusedAddr, bases, axis)
    var otherMin = 0
    for (i = 0; i < n; i++) if (i !== fi) otherMin += minNeed[i]
    fd = Math.max(minNeed[fi], Math.min(fd, total - otherMin))
    var wHere = unfocusedWeight(kids[fi], focusedAddr, bases, axis)
    var weights = []
    var unfocused = []
    var wOther = 0
    for (i = 0; i < n; i++) {
      if (i === fi) continue
      unfocused.push(i)
      var wt = subtreeWeight(kids[i], bases, axis)
      weights.push(wt)
      wOther += wt
    }
    var remainder = total - fd
    var shareHere = 0
    if (remainder > 0 && (wHere + wOther) > 0) shareHere = remainder * wHere / (wHere + wOther)
    var sizeFi = fd + shareHere
    sizeFi = Math.max(minNeed[fi], Math.min(sizeFi, total - otherMin))
    var rem2 = total - sizeFi
    var shares = shareRemainder(weights, rem2, minS)
    for (i = 0; i < n; i++) sizesAlong[i] = 0
    sizesAlong[fi] = sizeFi
    for (i = 0; i < unfocused.length; i++) sizesAlong[unfocused[i]] = shares[i]
  } else {
    var weightsAll = []
    for (i = 0; i < n; i++) weightsAll.push(subtreeWeight(kids[i], bases, axis))
    sizesAlong = shareRemainder(weightsAll, total, minS)
  }
  for (i = 0; i < n; i++) {
    var span = sizesAlong[i]
    if (node.type === "v") fillTree(kids[i], { w: span, h: box.h }, focusedAddr, bases, mon, out)
    else fillTree(kids[i], { w: box.w, h: span }, focusedAddr, bases, mon, out)
  }
}

function boundingBox(windows) {
  if (!windows || !windows.length) return { w: 0, h: 0 }
  var x0 = windows[0].x
  var y0 = windows[0].y
  var x1 = windows[0].x + windows[0].w
  var y1 = windows[0].y + windows[0].h
  var i
  for (i = 1; i < windows.length; i++) {
    var w = windows[i]
    if (w.x < x0) x0 = w.x
    if (w.y < y0) y0 = w.y
    if (w.x + w.w > x1) x1 = w.x + w.w
    if (w.y + w.h > y1) y1 = w.y + w.h
  }
  return { w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) }
}

function layoutOps(focused, byAddress, mon, bases, includeFloating, mode) {
  mode = mode || "focused"
  var all = [focused].concat(tiledSiblings(focused, byAddress, includeFloating))
  var sizes = {}
  var wTargets = {}
  if (!all.length) return { ops: [], sizes: sizes, wTargets: wTargets }
  var box = boundingBox(all)
  fillTree(buildTree(all), { w: box.w, h: box.h }, focused.address, bases, mon, sizes)
  var axes = claimAxes(focused, bases, all, mon)

  var ops = []
  var addr
  for (addr in sizes) {
    if (mode === "focused" && addr !== focused.address) continue
    var win = byAddress[addr]
    if (!win) continue
    var sameCol = overlapAmount(win.x, win.x + win.w, focused.x, focused.x + focused.w) > 24
    if (mode === "others") {
      if (addr === focused.address) continue
    }
    var d = deltaToTarget(win, mon, sizes[addr])
    if (yInterior(win, mon)) d.y = 0
    if (mode === "others" && sameCol) d.x = 0
    if (axes.x && Math.abs(d.x) > 2) ops.push({ address: addr, dx: d.x, dy: 0 })
    if (axes.y && Math.abs(d.y) > 2) ops.push({ address: addr, dx: 0, dy: d.y })
  }
  return { ops: ops, sizes: sizes, wTargets: wTargets }
}

function usableMin(mon, overcrowdCfg) {
  var wa = mon && mon.wa ? mon.wa : null
  var w = wa && wa.w > 0 ? wa.w : 1920
  var h = wa && wa.h > 0 ? wa.h : 1080
  var ratioW = overcrowdCfg && overcrowdCfg.minWidthRatio > 0 ? overcrowdCfg.minWidthRatio : 0.18
  var ratioH = overcrowdCfg && overcrowdCfg.minHeightRatio > 0 ? overcrowdCfg.minHeightRatio : 0.22
  return {
    w: Math.max(280, Math.round(w * ratioW)),
    h: Math.max(200, Math.round(h * ratioH))
  }
}

function nodeMinSize(node, min) {
  if (!node) return { w: 0, h: 0 }
  if (node.type === "leaf") return { w: min.w, h: min.h }
  var kids = nodeChildren(node)
  var i
  if (node.type === "v") {
    var sumW = 0
    var maxH = 0
    for (i = 0; i < kids.length; i++) {
      var vs = nodeMinSize(kids[i], min)
      sumW += vs.w
      if (vs.h > maxH) maxH = vs.h
    }
    return { w: sumW, h: maxH }
  }
  var maxW = 0
  var sumH = 0
  for (i = 0; i < kids.length; i++) {
    var hs = nodeMinSize(kids[i], min)
    if (hs.w > maxW) maxW = hs.w
    sumH += hs.h
  }
  return { w: maxW, h: sumH }
}

function isSpecialWorkspace(workspaceId) {
  if (workspaceId === undefined || workspaceId === null || workspaceId === "") return true
  var s = String(workspaceId)
  if (s.indexOf("special") !== -1) return true
  var n = Number(workspaceId)
  if (isFinite(n) && n < 1) return true
  return false
}

function nextWorkspace(workspaceId) {
  var n = Number(workspaceId)
  if (!isFinite(n) || n < 1) return 0
  return Math.round(n) + 1
}

function workspaceWindows(byAddress, workspaceId, includeFloating, monitorId) {
  var out = []
  var list = clientsList(byAddress)
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!isGrowable(o, includeFloating)) continue
    if (String(o.workspaceId) !== String(workspaceId)) continue
    if (monitorId !== undefined && monitorId !== null && Number(o.monitor) !== Number(monitorId)) continue
    out.push(o)
  }
  out.sort(function (a, b) {
    if (Math.abs(a.y - b.y) > 24) return a.y - b.y
    return a.x - b.x
  })
  return out
}

function overcrowded(windows, mon, overcrowdCfg) {
  if (!windows || windows.length < 3) return false
  var min = usableMin(mon, overcrowdCfg)
  var wa = mon && mon.wa && mon.wa.w > 0 && mon.wa.h > 0 ? mon.wa : { w: 1920, h: 1080 }
  var need = nodeMinSize(buildTree(windows), min)
  if (need.w > wa.w || need.h > wa.h) return true
  var i
  for (i = 0; i < windows.length; i++) {
    if (windows[i].w < min.w || windows[i].h < min.h) return true
  }
  return false
}

function suggestMove(windows, mon, focusedAddr, overcrowdCfg) {
  var keep = windows ? windows.slice() : []
  var suggested = []
  while (keep.length >= 3 && overcrowded(keep, mon, overcrowdCfg)) {
    var pick = -1
    var pickArea = Infinity
    var i
    for (i = 0; i < keep.length; i++) {
      if (keep[i].address === focusedAddr) continue
      var a = keep[i].w * keep[i].h
      if (a < pickArea) {
        pickArea = a
        pick = i
      }
    }
    if (pick < 0) break
    suggested.push(keep[pick].address)
    keep.splice(pick, 1)
  }
  return suggested
}

function promptSignature(workspaceId, windows) {
  var addrs = []
  var list = windows || []
  for (var i = 0; i < list.length; i++) addrs.push(String(list[i].address || ""))
  addrs.sort()
  return String(workspaceId) + "::" + addrs.join(",")
}

function dialogWindows(windows) {
  var out = []
  var list = windows || []
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    out.push({
      address: w.address,
      title: w.title || w.cls || w.address,
      cls: w.cls || "",
      w: w.w,
      h: w.h
    })
  }
  return out
}

function overcrowdedPlan(byAddress, focused, mon, includeFloating, overcrowdCfg) {
  if (overcrowdCfg && overcrowdCfg.enabled === false) return null
  if (!focused || isSpecialWorkspace(focused.workspaceId)) return null
  var nextId = nextWorkspace(focused.workspaceId)
  if (!(nextId > 0)) return null
  var monitorId = focused.monitor
  var windows = workspaceWindows(byAddress, focused.workspaceId, includeFloating, monitorId)
  if (!overcrowded(windows, mon, overcrowdCfg)) return null
  return {
    workspaceId: focused.workspaceId,
    nextWorkspaceId: nextId,
    windows: windows,
    suggested: suggestMove(windows, mon, focused.address, overcrowdCfg),
    signature: promptSignature(focused.workspaceId, windows)
  }
}

function moveCommand(address, workspaceId) {
  return 'hl.dsp.window.move({ window = "address:' + String(address) + '", workspace = "' + String(workspaceId) + '", follow = false })'
}

function moveCommands(addresses, workspaceId) {
  var parts = []
  var list = addresses || []
  for (var i = 0; i < list.length; i++) parts.push(moveCommand(list[i], workspaceId))
  return parts.join("; ")
}

function moveShell(addresses, workspaceId) {
  var parts = []
  var list = addresses || []
  for (var i = 0; i < list.length; i++) {
    parts.push("hyprctl dispatch '" + moveCommand(list[i], workspaceId) + "'")
  }
  return parts.join("; ")
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseJson: parseJson,
    numberOr: numberOr,
    parseConfig: parseConfig,
    windowMeta: windowMeta,
    parseClients: parseClients,
    parseActiveWindow: parseActiveWindow,
    parseMonitors: parseMonitors,
    monitorForWindow: monitorForWindow,
    isGrowable: isGrowable,
    baseKey: baseKey,
    classKey: classKey,
    lookupBase: lookupBase,
    purgeAddress: purgeAddress,
    pruneOrphans: pruneOrphans,
    isEmptyMap: isEmptyMap,
    overlayBirths: overlayBirths,
    overlayDemand: overlayDemand,
    shouldLayout: shouldLayout,
    captureBirths: captureBirths,
    captureOneBirth: captureOneBirth,
    captureWorkspaceBirths: captureWorkspaceBirths,
    findClient: findClient,
    edgeSigns: edgeSigns,
    deltaToTarget: deltaToTarget,
    sameSize: sameSize,
    mergeBases: mergeBases,
    mergeAxisBase: mergeAxisBase,
    claimAxes: claimAxes,
    resizeCommand: resizeCommand,
    clientsList: clientsList,
    minDim: minDim,
    tiledSiblings: tiledSiblings,
    groupAlong: groupAlong,
    configuredDim: configuredDim,
    shareRemainder: shareRemainder,
    axisTargets: axisTargets,
    layoutOps: layoutOps,
    usableMin: usableMin,
    overcrowded: overcrowded,
    suggestMove: suggestMove,
    nextWorkspace: nextWorkspace,
    isSpecialWorkspace: isSpecialWorkspace,
    workspaceWindows: workspaceWindows,
    promptSignature: promptSignature,
    dialogWindows: dialogWindows,
    overcrowdedPlan: overcrowdedPlan,
    moveCommand: moveCommand,
    moveCommands: moveCommands,
    moveShell: moveShell
  }
}
