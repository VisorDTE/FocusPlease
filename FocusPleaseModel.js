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

function parseConfig(fileRaw) {
  var file = parseJson(fileRaw, {})
  if (!file || typeof file !== "object" || Array.isArray(file)) file = {}
  return {
    enabled: file.enabled !== false,
    includeFloating: !!file.includeFloating
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
    if (w > 0 && h > 0) out[key] = { w: w, h: h }
  }
  return out
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
    if (Math.abs(d.x) > 2) ops.push({ address: addr, dx: d.x, dy: 0 })
    if (Math.abs(d.y) > 2) ops.push({ address: addr, dx: 0, dy: d.y })
  }
  return { ops: ops, sizes: sizes, wTargets: wTargets }
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
    edgeSigns: edgeSigns,
    deltaToTarget: deltaToTarget,
    sameSize: sameSize,
    mergeBases: mergeBases,
    resizeCommand: resizeCommand,
    clientsList: clientsList,
    minDim: minDim,
    tiledSiblings: tiledSiblings,
    groupAlong: groupAlong,
    configuredDim: configuredDim,
    shareRemainder: shareRemainder,
    axisTargets: axisTargets,
    layoutOps: layoutOps
  }
}
