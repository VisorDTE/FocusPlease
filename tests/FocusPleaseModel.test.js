const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const {
  parseConfig, parseClients, parseMonitors, isGrowable, baseKey,
  deltaToTarget, sameSize, mergeBases, resizeCommand, minDim,
  configuredDim, shareRemainder, axisTargets, groupAlong, layoutOps,
  usableMin, overcrowded, suggestMove, nextWorkspace, isSpecialWorkspace,
  overcrowdedPlan, promptSignature, moveCommand, moveCommands, moveShell, dialogWindows,
  overlayBirths, overlayDemand, shouldLayout, captureBirths, captureOneBirth, captureWorkspaceBirths,
  purgeAddress, pruneOrphans, mergeAxisBase
} = require("../FocusPleaseModel.js")

const mon = { id: 0, width: 1920, height: 1080, scale: 1, wa: { x: 0, y: 0, w: 1920, h: 1080 } }

function win(addr, cls, x, w, extra) {
  return Object.assign({
    address: addr,
    cls: cls,
    w: w,
    h: 1068,
    x: x,
    y: 6,
    workspaceId: 1,
    floating: false,
    fullscreen: false,
    pinned: false,
    mapped: true,
    monitor: 0
  }, extra || {})
}

describe("parseConfig", () => {
  it("defaults to enabled, no floating, overcrowd on", () => {
    const cfg = parseConfig("{}")
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.includeFloating, false)
    assert.equal(cfg.overcrowd.enabled, true)
    assert.equal(cfg.overcrowd.minWidthRatio, 0.18)
    assert.equal(cfg.overcrowd.minHeightRatio, 0.22)
  })

  it("honors enabled and includeFloating", () => {
    const cfg = parseConfig('{"enabled":false,"includeFloating":true}')
    assert.equal(cfg.enabled, false)
    assert.equal(cfg.includeFloating, true)
  })

  it("accepts only absolute binary path overrides", () => {
    const cfg = parseConfig('{"nodePath":"/usr/bin/node","hyprctlPath":"relative/path","bashPath":5,"timeoutPath":"/opt/timeout"}')
    assert.equal(cfg.bins.node, "/usr/bin/node")
    assert.equal(cfg.bins.hyprctl, "")
    assert.equal(cfg.bins.bash, "")
    assert.equal(cfg.bins.timeout, "/opt/timeout")
  })
})

describe("parseClients", () => {
  it("indexes windows by address and normalizes geometry", () => {
    const raw = JSON.stringify([
      { address: "0x1", class: "org.foot", title: "foot", size: [100, 200], at: [10, 20], workspace: { id: 1 }, monitor: 0 }
    ])
    const clients = parseClients(raw)
    assert.equal(clients["0x1"].cls, "org.foot")
    assert.equal(clients["0x1"].title, "foot")
    assert.equal(clients["0x1"].w, 100)
    assert.equal(clients["0x1"].x, 10)
  })
})

describe("parseMonitors", () => {
  it("computes the work area from reserved space", () => {
    const raw = JSON.stringify([{ id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1, reserved: [0, 0, 33, 0] }])
    const monitors = parseMonitors(raw)
    assert.equal(monitors[0].wa.x, 0)
    assert.equal(monitors[0].wa.w, 1887)
  })
})

describe("isGrowable", () => {
  const base = { address: "0x1", cls: "a", w: 100, h: 100, mapped: true, floating: false, fullscreen: false, pinned: false }

  it("grows a normal tiled window", () => {
    assert.equal(isGrowable(base, false), true)
  })

  it("rejects floating unless includeFloating", () => {
    assert.equal(isGrowable({ ...base, floating: true }, false), false)
    assert.equal(isGrowable({ ...base, floating: true }, true), true)
  })
})

describe("baseKey", () => {
  it("keys by workspace and class", () => {
    assert.equal(baseKey({ cls: "org.foot", workspaceId: 3, address: "0x1" }), "ws3::org.foot::0x1")
  })
})

describe("deltaToTarget", () => {
  it("grows a left window rightward with a positive delta", () => {
    const w = { x: 6, y: 6, w: 900, h: 1068 }
    assert.deepEqual(deltaToTarget(w, mon, { w: 1000, h: 1068 }), { x: 100, y: 0 })
  })

  it("grows a right window leftward with a negative delta", () => {
    const w = { x: 1120, y: 6, w: 793, h: 1068 }
    assert.deepEqual(deltaToTarget(w, mon, { w: 900, h: 1068 }), { x: -107, y: 0 })
  })
})

describe("shareRemainder", () => {
  it("splits equally when weights match", () => {
    assert.deepEqual(shareRemainder([640, 640], 920, 80), [460, 460])
  })
})

describe("axisTargets two windows", () => {
  const A = win("0xa", "app.a", 0, 920)
  const B = win("0xb", "app.b", 920, 1000)
  const group = [A, B]

  it("gives A 1000px when focused and configured, B gets the rest", () => {
    const bases = { "ws1::app.a": { w: 1000, h: 1068 } }
    const t = axisTargets(A, group, bases, mon, "x")
    assert.equal(t["0xa"], 1000)
    assert.equal(t["0xb"], 920)
  })

  it("swaps sizes when both ask for 1000px", () => {
    const bases = {
      "ws1::app.a": { w: 1000, h: 1068 },
      "ws1::app.b": { w: 1000, h: 1068 }
    }
    const tA = axisTargets(A, group, bases, mon, "x")
    const tB = axisTargets(B, group, bases, mon, "x")
    assert.equal(tA["0xa"], 1000)
    assert.equal(tA["0xb"], 920)
    assert.equal(tB["0xb"], 1000)
    assert.equal(tB["0xa"], 920)
  })

  it("gives B 1200px when focused, A 720px", () => {
    const bases = { "ws1::app.b": { w: 1200, h: 1068 } }
    const t = axisTargets(B, group, bases, mon, "x")
    assert.equal(t["0xb"], 1200)
    assert.equal(t["0xa"], 720)
  })
})

describe("axisTargets three windows", () => {
  const A = win("0xa", "app.a", 0, 640)
  const B = win("0xb", "app.b", 640, 640)
  const C = win("0xc", "app.c", 1280, 640)
  const group = [A, B, C]

  it("unconfigured windows share equally (640 each)", () => {
    const t = axisTargets(A, group, {}, mon, "x")
    assert.equal(t["0xa"], 640)
    assert.equal(t["0xb"], 640)
    assert.equal(t["0xc"], 640)
  })

  it("A at 1000px, B and C unconfigured split the rest 50/50", () => {
    const bases = { "ws1::app.a": { w: 1000, h: 1068 } }
    const t = axisTargets(A, group, bases, mon, "x")
    assert.equal(t["0xa"], 1000)
    assert.equal(t["0xb"], 460)
    assert.equal(t["0xc"], 460)
  })
})

describe("stacked windows are one column", () => {
  const C = win("0xc", "chromium", 6, 779)
  const A = win("0xa", "org.omarchy.agent", 793, 693)
  const N1 = win("0xn1", "org.gnome.Nautilus", 1494, 387, { h: 486, y: 6 })
  const N2 = win("0xn2", "org.gnome.Nautilus", 1494, 387, { h: 574, y: 500 })
  const clients = { "0xc": C, "0xa": A, "0xn1": N1, "0xn2": N2 }

  it("groups four windows into three columns", () => {
    const g = groupAlong(C, clients, false, "x")
    assert.equal(g.length, 3)
  })

  it("does not merge columns that only overlap by a couple of pixels", () => {
    const C = win("0xc", "chromium", 6, 904)
    const A = win("0xa", "org.omarchy.agent", 918, 630)
    const N1 = win("0xn1", "org.gnome.Nautilus", 1546, 252)
    const g = groupAlong(C, { "0xc": C, "0xa": A, "0xn1": N1 }, false, "x")
    assert.equal(g.length, 3)
  })

  it("merges a spanning fifth window into the right column, not a fourth", () => {
    const C = win("0xc", "chromium", 6, 904)
    const A = win("0xa", "org.omarchy.agent", 918, 630)
    const N1 = win("0xn1", "org.gnome.Nautilus", 1556, 252, { h: 486, y: 6 })
    const N2 = win("0xn2", "org.gnome.Nautilus", 1556, 325, { h: 574, y: 500 })
    const N3 = win("0xn3", "org.gnome.Nautilus", 1816, 65, { h: 486, y: 6 })
    const clients = { "0xc": C, "0xa": A, "0xn1": N1, "0xn2": N2, "0xn3": N3 }
    const g = groupAlong(C, clients, false, "x")
    assert.equal(g.length, 3)
  })

  it("makes the center cede when the left window claims 1000px", () => {
    const bases = { "ws1::chromium": { w: 1000, h: 1068 } }
    const g = groupAlong(C, clients, false, "x")
    const t = axisTargets(C, g, bases, mon, "x")
    assert.equal(t["0xc"], 1000)
    assert.ok(t["0xa"] < 693)
    assert.ok(t["0xa"] > 300)
  })
})

describe("split column borrows from other columns", () => {
  const C = win("0xc", "chromium", 6, 869)
  const A = win("0xa", "org.omarchy.agent", 883, 666, { h: 676 })
  const F = win("0xf", "foot", 883, 666, { h: 384, y: 690 })
  const N1 = win("0xn1", "org.gnome.Nautilus", 1557, 151, { h: 530, y: 6 })
  const N3 = win("0xn3", "org.gnome.Nautilus", 1716, 165, { h: 530, y: 6 })
  const N2 = win("0xn2", "org.gnome.Nautilus", 1557, 324, { h: 530, y: 544 })
  const clients = { "0xc": C, "0xa": A, "0xf": F, "0xn1": N1, "0xn3": N3, "0xn2": N2 }
  const bases = {
    "ws1::org.gnome.Nautilus::0xn3": { w: 324, h: 530 },
    "ws1::org.gnome.Nautilus::0xn1": { w: 274, h: 530 }
  }

  it("grows the right column past 324px so the focused split window can be 324 without eating its sibling alone", () => {
    const plan = layoutOps(N3, clients, mon, bases, false, "focused")
    const colW = plan.sizes["0xn3"].w + plan.sizes["0xn1"].w
    assert.ok(colW > 324, "column should be wider than the focused window alone")
    assert.ok(plan.sizes["0xc"].w < 869, "left column should cede width")
  })
})

describe("nested top-row split borrows from the other column", () => {
  const A = win("0xa", "org.omarchy.agent", 6, 934)
  const F = win("0xf", "foot", 948, 884, { h: 686, y: 6 })
  const C = win("0xc", "chromium", 1840, 41, { h: 686, y: 6 })
  const N = win("0xn", "org.gnome.Nautilus", 948, 933, { h: 374, y: 700 })
  const clients = { "0xa": A, "0xf": F, "0xc": C, "0xn": N }
  const bases = {
    "ws1::foot": { w: 933, h: 686 },
    "ws1::chromium": { w: 751, h: 686 },
    "ws1::org.gnome.Nautilus": { w: 1179, h: 674 }
  }

  it("gives the terminal its width without crushing the browser or OpenCode", () => {
    const plan = layoutOps(F, clients, mon, bases, false, "focused")
    assert.ok(plan.sizes["0xf"].w >= 900, "terminal should claim ~933")
    assert.ok(plan.sizes["0xc"].w > 200, "browser should stay usable")
    assert.ok(plan.sizes["0xa"].w > 300, "OpenCode should not be squeezed to the minimum")
  })

  it("emits an other-column resize so the terminal does not only eat the browser", () => {
    const plan = layoutOps(F, clients, mon, bases, false, "others")
    const agent = plan.ops.filter(o => o.address === "0xa")
    assert.ok(agent.length >= 1, "OpenCode should cede width")
  })
})

describe("three stacked windows in one column", () => {
  const L = win("0xl", "left.app", 0, 640)
  const T = win("0xt", "stack.top", 640, 1280, { h: 200, y: 6 })
  const M = win("0xm", "stack.mid", 640, 1280, { h: 400, y: 206 })
  const B = win("0xb", "stack.bot", 640, 1280, { h: 468, y: 606 })
  const clients = { "0xl": L, "0xt": T, "0xm": M, "0xb": B }
  const bases = {
    "ws1::stack.top": { w: 800, h: 300 },
    "ws1::stack.mid": { w: 800, h: 400 },
    "ws1::stack.bot": { w: 800, h: 500 }
  }

  it("gives the middle window its configured height without pinning a sibling to the minimum", () => {
    const plan = layoutOps(M, clients, mon, bases, false, "focused")
    assert.equal(plan.sizes["0xm"].h, 400)
    assert.ok(plan.sizes["0xt"].h > 120, "top sibling should keep a fair remainder")
    assert.ok(plan.sizes["0xb"].h > 200, "bottom sibling should keep a fair remainder")
  })

  it("gives the top stacked window its configured height", () => {
    const plan = layoutOps(T, clients, mon, bases, false, "focused")
    assert.equal(plan.sizes["0xt"].h, 300)
  })

  it("gives the bottom stacked window its configured height", () => {
    const plan = layoutOps(B, clients, mon, bases, false, "focused")
    assert.equal(plan.sizes["0xb"].h, 500)
  })

  it("grows a middle stacked window by resizing siblings, not the middle window itself", () => {
    const fops = layoutOps(M, clients, mon, bases, false, "focused").ops
    const oops = layoutOps(M, clients, mon, bases, false, "others").ops
    assert.equal(fops.filter(o => o.address === "0xm" && o.dy !== 0).length, 0)
    assert.equal(oops.filter(o => o.address === "0xm" && o.dy !== 0).length, 0)
    assert.ok(oops.some(o => o.address !== "0xm" && o.dy !== 0))
  })

  it("splits leftover the same way regardless of current heights", () => {
    const T2 = win("0xt", "stack.top", 640, 1280, { h: 800, y: 6 })
    const M2 = win("0xm", "stack.mid", 640, 1280, { h: 100, y: 806 })
    const B2 = win("0xb", "stack.bot", 640, 1280, { h: 168, y: 906 })
    const clients2 = { "0xl": L, "0xt": T2, "0xm": M2, "0xb": B2 }
    const a = layoutOps(T, clients, mon, bases, false, "focused")
    const b = layoutOps(T2, clients2, mon, bases, false, "focused")
    assert.equal(a.sizes["0xt"].h, b.sizes["0xt"].h)
    assert.equal(a.sizes["0xm"].h, b.sizes["0xm"].h)
    assert.equal(a.sizes["0xb"].h, b.sizes["0xb"].h)
  })
})

describe("unconfigured focused window claims Hyprland birth size", () => {
  const A = win("0xa", "org.omarchy.agent", 6, 1234)
  const F = win("0xf", "foot", 1248, 1033, { h: 530, y: 6 })
  const N = win("0xn", "org.gnome.Nautilus", 1248, 1033, { h: 530, y: 544 })
  const clients = { "0xa": A, "0xf": F, "0xn": N }
  const user = {
    "ws1::org.omarchy.agent::0xa": { w: 1234, h: 1068 },
    "ws1::org.gnome.Nautilus::0xn": { w: 1033, h: 530 }
  }
  const births = { "ws1::foot::0xf": { w: 633, h: 530 } }

  it("does not reclaim birth when focused without a user resize", () => {
    assert.equal(shouldLayout(F, user), false)
    const d = overlayDemand(user, births, F)
    assert.equal(d["ws1::foot::0xf"], undefined)
    const plan = layoutOps(F, clients, mon, d, false, "focused")
    assert.equal(plan.sizes["0xf"].w, 1033)
  })

  it("user base still wins over birth", () => {
    const plan = layoutOps(N, clients, mon, overlayDemand(user, births, N), false, "focused")
    assert.equal(plan.sizes["0xn"].w, 1033)
  })

  it("still gives OpenCode its configured width", () => {
    const plan = layoutOps(A, clients, mon, overlayDemand(user, births, A), false, "focused")
    assert.equal(plan.sizes["0xa"].w, 1234)
  })

  it("does not overwrite an existing birth", () => {
    const cap = captureBirths(clients, births, false)
    assert.equal(cap.births["ws1::foot::0xf"].w, 633)
  })

  it("records only the new window as a birth", () => {
    const w = win("0xf", "foot", 0, 633, { h: 530 })
    const cap = captureOneBirth(w, {})
    assert.equal(cap.changed, true)
    assert.deepEqual(cap.births["ws1::foot::0xf"], { w: 633, h: 530 })
  })

  it("records birth from current size when missing", () => {
    const cap = captureBirths({ "0xf": F }, {}, false)
    assert.equal(cap.changed, true)
    assert.deepEqual(cap.births["ws1::foot::0xf"], { w: 1033, h: 530 })
  })

  it("does not record birth for a solo window", () => {
    const A = win("0xa", "org.omarchy.agent", 6, 1875)
    const cap = captureWorkspaceBirths({ "0xa": A }, {}, 1, false, 0)
    assert.equal(cap.changed, false)
    assert.equal(cap.births["ws1::org.omarchy.agent::0xa"], undefined)
  })

  it("records post-split sizes for both windows when the second opens", () => {
    const A = win("0xa", "org.omarchy.agent", 6, 940)
    const F = win("0xf", "foot", 954, 921)
    const cap = captureWorkspaceBirths({ "0xa": A, "0xf": F }, {}, 1, false, 0)
    assert.equal(cap.changed, true)
    assert.deepEqual(cap.births["ws1::org.omarchy.agent::0xa"], { w: 940, h: 1068 })
    assert.deepEqual(cap.births["ws1::foot::0xf"], { w: 921, h: 1068 })
  })

  it("lets a user base override a birth on the same key", () => {
    const merged = overlayBirths(
      { "ws1::foot::0xf": { w: 900, h: 530 } },
      { "ws1::foot::0xf": { w: 633, h: 530 } }
    )
    assert.deepEqual(merged["ws1::foot::0xf"], { w: 900, h: 530 })
  })
})

describe("layout only when the focused window has a user size", () => {
  const A = win("0xa", "org.omarchy.agent", 6, 1175)
  const N = win("0xn", "org.gnome.Nautilus", 1251, 630, { h: 582, y: 6 })
  const F = win("0xf", "foot", 1251, 630, { h: 478, y: 596 })
  const user = {
    "ws1::org.omarchy.agent::0xa": { w: 1129, h: 1068 },
    "ws1::org.gnome.Nautilus::0xn": { w: 838, h: 582 }
  }
  const births = {
    "ws1::foot::0xf": { w: 1068, h: 1068 },
    "ws1::org.gnome.Nautilus::0xn": { w: 630, h: 530 }
  }

  it("does not layout when the focused window was never resized", () => {
    assert.equal(shouldLayout(F, user), false)
    assert.equal(shouldLayout(A, user), true)
  })

  it("puts only the focused user base in demand, never births", () => {
    const d = overlayDemand(user, births, A)
    assert.equal(d["ws1::org.omarchy.agent::0xa"].w, 1129)
    assert.equal(d["ws1::org.gnome.Nautilus::0xn"], undefined)
    assert.equal(d["ws1::foot::0xf"], undefined)
  })

  it("still claims Nautilus user width when Nautilus is focused", () => {
    const clients = { "0xa": A, "0xn": N, "0xf": F }
    const plan = layoutOps(N, clients, mon, overlayDemand(user, births, N), false, "focused")
    assert.equal(plan.sizes["0xn"].w, 838)
  })
})

describe("configuredDim", () => {
  it("uses equal share when there is no persisted size", () => {
    const w = win("0xa", "app.a", 0, 640)
    assert.equal(configuredDim(w, {}, 1920, 3, "x"), 640)
  })

  it("uses the persisted pixel size when present", () => {
    const w = win("0xa", "app.a", 0, 640)
    assert.equal(configuredDim(w, { "ws1::app.a": { w: 1000, h: 1068 } }, 1920, 3, "x"), 1000)
  })
})

describe("mergeBases", () => {
  it("loads valid persisted bases and drops bad entries", () => {
    const merged = mergeBases('{"ws1::org.foot":{"w":900,"h":600},"bad":{"w":0},"x":5}')
    assert.deepEqual(merged["ws1::org.foot"], { w: 900, h: 600 })
    assert.equal(merged["bad"], undefined)
  })

  it("keeps a width-only user size", () => {
    const merged = mergeBases('{"ws1::foot":{"w":933}}')
    assert.deepEqual(merged["ws1::foot"], { w: 933 })
  })
})

describe("mergeAxisBase", () => {
  it("records only the axis that changed", () => {
    const next = mergeAxisBase({}, { w: 400, h: 974 }, { w: 933, h: 974 }, 8)
    assert.deepEqual(next, { w: 933 })
  })

  it("keeps a previous width when only height changes", () => {
    const next = mergeAxisBase({ w: 933 }, { w: 933, h: 530 }, { w: 933, h: 700 }, 8)
    assert.deepEqual(next, { w: 933, h: 700 })
  })

  it("does not ratchet a stored width down by layout noise", () => {
    const next = mergeAxisBase({ w: 634 }, { w: 634, h: 1068 }, { w: 620, h: 1068 })
    assert.equal(next.w, 634)
  })
})

describe("claim only configured axes with real peers", () => {
  it("does not emit height ops when the only vertical sibling is a sliver", () => {
    const A = win("0xa", "org.omarchy.agent", 6, 1268)
    const F = win("0xf", "foot", 1282, 388, { h: 974, y: 6 })
    const N = win("0xn", "org.gnome.Nautilus", 1282, 599, { h: 86, y: 988 })
    const clients = { "0xa": A, "0xf": F, "0xn": N }
    const bases = { "ws1::foot::0xf": { w: 933, h: 530 } }
    const fops = layoutOps(F, clients, mon, bases, false, "focused").ops
    assert.equal(fops.filter(o => o.dy !== 0).length, 0)
    assert.ok(fops.some(o => o.address === "0xf" && o.dx !== 0))
  })
})

describe("resizeCommand", () => {
  it("builds a relative resize dispatch for a window address", () => {
    const cmd = resizeCommand("0x558d74431110", -107, 0)
    assert.equal(cmd,
      'hl.dsp.window.resize({ window = "address:0x558d74431110", x = -107, y = 0, relative = true })')
  })
})

function columns(n, screenW, extra) {
  const width = Math.floor((screenW || 1920) / n)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(win("0x" + i, "app." + i, i * width, width, extra))
  }
  return out
}

function stacked(n, extra) {
  const height = Math.floor(1068 / n)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(win("0ys" + i, "stack." + i, 0, 1920, Object.assign({ h: height, y: 6 + i * height }, extra || {})))
  }
  return out
}

describe("usableMin", () => {
  it("uses 18%/22% of a 1920x1080 work area", () => {
    const min = usableMin(mon)
    assert.equal(min.w, 346)
    assert.equal(min.h, 238)
  })

  it("floors at 280x200 on a small panel", () => {
    const small = { wa: { x: 0, y: 0, w: 1366, h: 768 } }
    const min = usableMin(small)
    assert.equal(min.w, 280)
    assert.equal(min.h, 200)
  })

  it("uses the scale-adjusted work area", () => {
    const monitors = parseMonitors(JSON.stringify([
      { id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1.25, reserved: [0, 0, 0, 0] }
    ]))
    const min = usableMin(monitors[0])
    assert.equal(monitors[0].wa.w, 1536)
    assert.equal(min.w, 280)
    assert.equal(min.h, 200)
  })
})

describe("overcrowded", () => {
  it("never flags fewer than 3 windows", () => {
    assert.equal(overcrowded(columns(2), mon), false)
  })

  it("allows 5 columns on 1920x1080", () => {
    assert.equal(overcrowded(columns(5), mon), false)
  })

  it("flags 6 columns on 1920x1080", () => {
    assert.equal(overcrowded(columns(6), mon), true)
  })

  it("flags 5 columns on 1366x768", () => {
    const small = { wa: { x: 0, y: 0, w: 1366, h: 768 } }
    assert.equal(overcrowded(columns(4, 1366), small), false)
    assert.equal(overcrowded(columns(5, 1366), small), true)
  })

  it("flags 5 stacked rows on 1080p", () => {
    assert.equal(overcrowded(stacked(3), mon), false)
    assert.equal(overcrowded(stacked(5), mon), true)
  })

  it("allows a nested split that still fits", () => {
    const left = win("0xa", "left", 0, 960)
    const t = win("0xt", "top", 960, 960, { h: 356, y: 6 })
    const m = win("0xm", "mid", 960, 960, { h: 356, y: 362 })
    const b = win("0xb", "bot", 960, 960, { h: 356, y: 718 })
    assert.equal(overcrowded([left, t, m, b], mon), false)
  })

  it("flags windows already crushed below the usable minimum", () => {
    const wins = columns(3)
    wins[2] = win("0x2", "app.2", 1280, 640, { h: 100, y: 6 })
    assert.equal(overcrowded(wins, mon), true)
  })
})

describe("suggestMove", () => {
  it("peels the smallest non-focused window until the tree fits", () => {
    const wins = columns(6, 3000)
    const suggested = suggestMove(wins, mon, "0x0")
    assert.equal(suggested.length, 1)
    assert.equal(suggested[0], "0x1")
  })

  it("does not suggest the focused window", () => {
    const wins = columns(6, 3000)
    const suggested = suggestMove(wins, mon, "0x1")
    assert.ok(!suggested.includes("0x1"))
  })
})

describe("overcrowdedPlan", () => {
  it("returns null when the workspace still fits", () => {
    const wins = columns(3)
    const byAddress = {}
    for (const w of wins) byAddress[w.address] = w
    assert.equal(overcrowdedPlan(byAddress, wins[0], mon, false, {}), null)
  })

  it("skips special workspaces", () => {
    const wins = columns(6, 1920, { workspaceId: "special:scratchpad" })
    const byAddress = {}
    for (const w of wins) byAddress[w.address] = w
    assert.equal(overcrowdedPlan(byAddress, wins[0], mon, false, {}), null)
  })

  it("builds a move plan to the next workspace", () => {
    const wins = columns(6, 3000)
    const byAddress = {}
    for (const w of wins) byAddress[w.address] = w
    const plan = overcrowdedPlan(byAddress, wins[0], mon, false, {})
    assert.equal(plan.workspaceId, 1)
    assert.equal(plan.nextWorkspaceId, 2)
    assert.equal(plan.windows.length, 6)
    assert.equal(plan.suggested.length, 1)
    assert.equal(plan.signature, promptSignature(1, wins))
  })

  it("honors overcrowd.enabled = false", () => {
    const wins = columns(6)
    const byAddress = {}
    for (const w of wins) byAddress[w.address] = w
    assert.equal(overcrowdedPlan(byAddress, wins[0], mon, false, { enabled: false }), null)
  })
})

describe("workspace helpers", () => {
  it("advances numeric workspaces and rejects specials", () => {
    assert.equal(nextWorkspace(3), 4)
    assert.equal(nextWorkspace("special:scratchpad"), 0)
    assert.equal(isSpecialWorkspace("special:scratchpad"), true)
    assert.equal(isSpecialWorkspace(1), false)
  })

  it("builds a silent move dispatch", () => {
    assert.equal(moveCommand("0xabc", 2),
      'hl.dsp.window.move({ window = "address:0xabc", workspace = "2", follow = false })')
    assert.equal(moveCommands(["0xa", "0xb"], 3),
      'hl.dsp.window.move({ window = "address:0xa", workspace = "3", follow = false }); hl.dsp.window.move({ window = "address:0xb", workspace = "3", follow = false })')
    assert.equal(moveShell(["0xa"], 2),
      "hyprctl dispatch 'hl.dsp.window.move({ window = \"address:0xa\", workspace = \"2\", follow = false })'")
  })

  it("drops size records for a closed window address", () => {
    const map = {
      "ws1::foot::0xabc": { w: 100, h: 100 },
      "ws1::chromium::0xdef": { w: 200, h: 200 }
    }
    const gone = purgeAddress(map, "0xabc")
    assert.equal(gone.changed, true)
    assert.equal(gone.map["ws1::foot::0xabc"], undefined)
    assert.deepEqual(gone.map["ws1::chromium::0xdef"], { w: 200, h: 200 })
  })

  it("does not wipe records when the client list is empty", () => {
    const map = { "ws1::foot::0xabc": { w: 100, h: 100 } }
    const pruned = pruneOrphans(map, {})
    assert.equal(pruned.changed, false)
    assert.deepEqual(pruned.map["ws1::foot::0xabc"], { w: 100, h: 100 })
  })

  it("prunes records whose window is no longer live", () => {
    const map = {
      "ws1::foot::0xabc": { w: 100, h: 100 },
      "ws1::chromium::0xdef": { w: 200, h: 200 }
    }
    const live = { "0xdef": win("0xdef", "chromium", 0, 200) }
    const pruned = pruneOrphans(map, live)
    assert.equal(pruned.changed, true)
    assert.equal(pruned.map["ws1::foot::0xabc"], undefined)
    assert.deepEqual(pruned.map["ws1::chromium::0xdef"], { w: 200, h: 200 })
  })

  it("dialogWindows prefers title then class", () => {
    const rows = dialogWindows([
      { address: "0x1", title: "README.md", cls: "foot", w: 10, h: 10 },
      { address: "0x2", title: "", cls: "chromium", w: 10, h: 10 }
    ])
    assert.equal(rows[0].title, "README.md")
    assert.equal(rows[1].title, "chromium")
  })
})
