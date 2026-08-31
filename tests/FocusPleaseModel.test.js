const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const {
  parseConfig, parseClients, parseMonitors, isGrowable, baseKey,
  deltaToTarget, sameSize, mergeBases, resizeCommand, minDim,
  configuredDim, shareRemainder, axisTargets, groupAlong, layoutOps
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
  it("defaults to enabled, no floating", () => {
    const cfg = parseConfig("{}")
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.includeFloating, false)
  })

  it("honors enabled and includeFloating", () => {
    const cfg = parseConfig('{"enabled":false,"includeFloating":true}')
    assert.equal(cfg.enabled, false)
    assert.equal(cfg.includeFloating, true)
  })
})

describe("parseClients", () => {
  it("indexes windows by address and normalizes geometry", () => {
    const raw = JSON.stringify([
      { address: "0x1", class: "org.foot", size: [100, 200], at: [10, 20], workspace: { id: 1 }, monitor: 0 }
    ])
    const clients = parseClients(raw)
    assert.equal(clients["0x1"].cls, "org.foot")
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
})

describe("resizeCommand", () => {
  it("builds a relative resize dispatch for a window address", () => {
    const cmd = resizeCommand("0x558d74431110", -107, 0)
    assert.equal(cmd,
      'hl.dsp.window.resize({ window = "address:0x558d74431110", x = -107, y = 0, relative = true })')
  })
})
