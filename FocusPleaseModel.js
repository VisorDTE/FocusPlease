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

function findGapSplit(windows, axis) {
  var sorted = windows.slice().sort(function (p, q) {
    return axis === "x" ? p.x - q.x : p.y - q.y
  })
  var i, j
  for (i = 1; i < sorted.length; i++) {
    var a = sorted.slice(0, i)
    var b = sorted.slice(i)
    var aMax = 0
    var bMin = 1e9
    for (j = 0; j < a.length; j++) {
      var end = axis === "x" ? a[j].x + a[j].w : a[j].y + a[j].h
      if (end > aMax) aMax = end
    }
    for (j = 0; j < b.length; j++) {
      var start = axis === "x" ? b[j].x : b[j].y
      if (start < bMin) bMin = start
    }
    if (aMax <= bMin + 12) return { a: a, b: b }
  }
  return null
}

function buildTree(windows) {
  if (!windows || windows.length === 0) return null
  if (windows.length === 1) return { type: "leaf", win: windows[0] }
  var v = findGapSplit(windows, "x")
  if (v) return { type: "v", a: buildTree(v.a), b: buildTree(v.b) }
  var h = findGapSplit(windows, "y")
  if (h) return { type: "h", a: buildTree(h.a), b: buildTree(h.b) }
  var sorted = windows.slice().sort(function (p, q) { return p.x - q.x })
  var mid = Math.max(1, Math.floor(sorted.length / 2))
  return { type: "v", a: buildTree(sorted.slice(0, mid)), b: buildTree(sorted.slice(mid)) }
}

function treeContains(node, addr) {
  if (!node) return false
  if (node.type === "leaf") return node.win.address === addr
  return treeContains(node.a, addr) || treeContains(node.b, addr)
}

function subtreeWeight(node, bases, axis) {
  if (!node) return 0
  if (node.type === "leaf") {
    var b = lookupBase(node.win, bases)
    var v = b ? numberOr(axis === "x" ? b.w : b.h, 0) : 0
    if (v > 0) return v
    return axis === "x" ? node.win.w : node.win.h
  }
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y"))
    return Math.max(subtreeWeight(node.a, bases, axis), subtreeWeight(node.b, bases, axis))
  return subtreeWeight(node.a, bases, axis) + subtreeWeight(node.b, bases, axis)
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
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y"))
    return Math.max(focusedDemand(node.a, focusedAddr, bases, axis), focusedDemand(node.b, focusedAddr, bases, axis))
  return focusedDemand(node.a, focusedAddr, bases, axis) + focusedDemand(node.b, focusedAddr, bases, axis)
}

function stripClaim(strip, focused, bases, available, n, axis, mon) {
  var i
  var hasFocused = false
  for (i = 0; i < strip.windows.length; i++) {
    if (strip.windows[i].address === focused.address) {
      hasFocused = true
      break
    }
  }
  if (!hasFocused || strip.windows.length === 1)
    return configuredDim(stripRep(strip, focused, axis), bases, available, n, axis)

  var tree = buildTree(strip.windows)
  var demand = stripClaimTree(tree, focused.address, bases, axis)
  var minS = minDim(mon, axis)
  if (demand < minS) demand = minS
  return demand
}

function stripClaimTree(node, focusedAddr, bases, axis) {
  if (!node) return 0
  if (node.type === "leaf") {
    if (node.win.address === focusedAddr) {
      var b = lookupBase(node.win, bases)
      var v = b ? numberOr(axis === "x" ? b.w : b.h, 0) : 0
      if (v > 0) return v
      return axis === "x" ? node.win.w : node.win.h
    }
    return subtreeWeight(node, bases, axis)
  }
  if ((node.type === "h" && axis === "x") || (node.type === "v" && axis === "y"))
    return Math.max(stripClaimTree(node.a, focusedAddr, bases, axis), stripClaimTree(node.b, focusedAddr, bases, axis))
  return stripClaimTree(node.a, focusedAddr, bases, axis) + stripClaimTree(node.b, focusedAddr, bases, axis)
}

function fillTree(node, box, focusedAddr, bases, mon, out) {
  if (!node) return
  if (node.type === "leaf") {
    out[node.win.address] = { w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) }
    return
  }
  var axis = node.type === "v" ? "x" : "y"
  var total = axis === "x" ? box.w : box.h
  var minS = minDim(mon, axis)
  var fa = treeContains(node.a, focusedAddr)
  var fb = treeContains(node.b, focusedAddr)
  var sizeA
  if (fa || fb) {
    var demand = focusedDemand(fa ? node.a : node.b, focusedAddr, bases, axis)
    demand = Math.max(minS, Math.min(demand, total - minS))
    sizeA = fa ? demand : total - demand
  } else {
    var wa = subtreeWeight(node.a, bases, axis)
    var wb = subtreeWeight(node.b, bases, axis)
    sizeA = Math.round(total * wa / Math.max(1, wa + wb))
    sizeA = Math.max(minS, Math.min(sizeA, total - minS))
  }
  if (node.type === "v") {
    fillTree(node.a, { w: sizeA, h: box.h }, focusedAddr, bases, mon, out)
    fillTree(node.b, { w: total - sizeA, h: box.h }, focusedAddr, bases, mon, out)
  } else {
    fillTree(node.a, { w: box.w, h: sizeA }, focusedAddr, bases, mon, out)
    fillTree(node.b, { w: box.w, h: total - sizeA }, focusedAddr, bases, mon, out)
  }
}

function assignStrip(strip, width, focused, bases, mon, sizes) {
  if (strip.windows.length === 1) {
    sizes[strip.windows[0].address] = { w: width, h: strip.windows[0].h }
    return
  }
  var y0 = strip.windows[0].y
  var y1 = strip.windows[0].y + strip.windows[0].h
  var i
  for (i = 1; i < strip.windows.length; i++) {
    var w = strip.windows[i]
    if (w.y < y0) y0 = w.y
    if (w.y + w.h > y1) y1 = w.y + w.h
  }
  fillTree(buildTree(strip.windows), { w: width, h: Math.max(1, y1 - y0) }, focused.address, bases, mon, sizes)
}

function layoutOps(focused, byAddress, mon, bases, includeFloating, mode) {
  mode = mode || "focused"
  var all = [focused].concat(tiledSiblings(focused, byAddress, includeFloating))
  var strips = clusterStrips(all, "x")
  var reps = []
  var s
  for (s = 0; s < strips.length; s++) reps.push(stripRep(strips[s], focused, "x"))
  var available = 0
  for (s = 0; s < strips.length; s++) available += Math.max(1, Math.round(strips[s].a2 - strips[s].a1))
  var n = strips.length
  var claims = []
  for (s = 0; s < n; s++) claims.push(stripClaim(strips[s], focused, bases, available, n, "x", mon))
  var fi = -1
  for (s = 0; s < n; s++) {
    for (var wi = 0; wi < strips[s].windows.length; wi++) {
      if (strips[s].windows[wi].address === focused.address) fi = s
    }
  }
  var wTargets = {}
  if (n >= 2 && fi >= 0) {
    var minSize = minDim(mon, "x")
    var focusedTarget = Math.round(Math.min(claims[fi], available - (n - 1) * minSize))
    if (focusedTarget < minSize) focusedTarget = minSize
    var remainder = available - focusedTarget
    var weights = []
    var unfocused = []
    for (s = 0; s < n; s++) {
      if (s === fi) continue
      unfocused.push(s)
      weights.push(claims[s])
    }
    var shares = shareRemainder(weights, remainder, minSize)
    wTargets[reps[fi].address] = focusedTarget
    for (s = 0; s < unfocused.length; s++) wTargets[reps[unfocused[s]].address] = shares[s]
  }
  var sizes = {}
  for (s = 0; s < strips.length; s++) {
    var tw = wTargets[reps[s].address]
    var width = tw === undefined ? reps[s].w : tw
    assignStrip(strips[s], width, focused, bases, mon, sizes)
  }

  var ops = []
  var addr
  for (addr in sizes) {
    if (mode === "focused" && addr !== focused.address) continue
    if (mode === "others" && (addr === focused.address || strips.length === 2)) continue
    var win = byAddress[addr]
    if (!win) continue
    var d = deltaToTarget(win, mon, sizes[addr])
    if (Math.abs(d.x) > 2 || Math.abs(d.y) > 2) ops.push({ address: addr, dx: d.x, dy: d.y })
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
