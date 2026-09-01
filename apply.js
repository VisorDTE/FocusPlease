const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const M = require(path.join(__dirname, "FocusPleaseModel.js"))

function hyprj(what) {
  return execFileSync("hyprctl", ["-j", what], { encoding: "utf8" })
}

function dispatch(lua) {
  execFileSync("hyprctl", ["dispatch", lua], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

function pick(ops) {
  if (!ops || !ops.length) return null
  var best = ops[0]
  var bestAbs = Math.abs(best.dx) + Math.abs(best.dy)
  for (var i = 1; i < ops.length; i++) {
    var abs = Math.abs(ops[i].dx) + Math.abs(ops[i].dy)
    if (abs > bestAbs) {
      best = ops[i]
      bestAbs = abs
    }
  }
  var dx = best.dx
  var dy = best.dy
  if (Math.abs(dx) >= Math.abs(dy)) dy = 0
  else dx = 0
  if (Math.abs(dx) <= 24 && Math.abs(dy) <= 24) return null
  return { address: best.address, dx: dx, dy: dy }
}

const focusedAddr = String(process.argv[2] || "")
const includeFloating = process.argv[3] === "1"
if (!focusedAddr) process.exit(0)

var bases = {}
try {
  bases = M.mergeBases(fs.readFileSync(process.env.HOME + "/.local/state/omarchy/focusplease/bases.json", "utf8"))
} catch (e) {}

function step(mode) {
  var clients = M.parseClients(hyprj("clients"))
  var monitors = M.parseMonitors(hyprj("monitors"))
  var focused = clients[focusedAddr]
  if (!focused || !M.isGrowable(focused, includeFloating)) return false
  var mon = M.monitorForWindow(focused, monitors)
  var plan = M.layoutOps(focused, clients, mon, bases, includeFloating, mode)
  var op = pick(plan.ops)
  if (!op) return false
  var before = clients[op.address]
  dispatch(M.resizeCommand(op.address, op.dx, op.dy))
  var after = M.parseClients(hyprj("clients"))[op.address]
  if (before && after && M.sameSize(before, after, 8)) return false
  return true
}

var i
for (i = 0; i < 2; i++) {
  if (!step("focused")) break
}
for (i = 0; i < 3; i++) {
  if (!step("others")) break
}
