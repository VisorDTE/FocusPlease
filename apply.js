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

const focusedAddr = String(process.argv[2] || "")
const includeFloating = process.argv[3] === "1"
if (!focusedAddr) process.exit(0)

var bases = {}
try {
  bases = M.mergeBases(fs.readFileSync(process.env.HOME + "/.local/state/omarchy/focusplease/bases.json", "utf8"))
} catch (e) {}

for (var round = 0; round < 12; round++) {
  var clients = M.parseClients(hyprj("clients"))
  var monitors = M.parseMonitors(hyprj("monitors"))
  var focused = clients[focusedAddr]
  if (!focused || !M.isGrowable(focused, includeFloating)) break
  var mon = M.monitorForWindow(focused, monitors)
  var mode = round === 0 ? "focused" : "others"
  var plan = M.layoutOps(focused, clients, mon, bases, includeFloating, mode)
  if (!plan.ops.length) {
    if (mode === "focused") continue
    break
  }
  var best = plan.ops[0]
  var bestAbs = Math.abs(best.dx) + Math.abs(best.dy)
  for (var i = 1; i < plan.ops.length; i++) {
    var abs = Math.abs(plan.ops[i].dx) + Math.abs(plan.ops[i].dy)
    if (abs > bestAbs) {
      best = plan.ops[i]
      bestAbs = abs
    }
  }
  dispatch(M.resizeCommand(best.address, best.dx, best.dy))
}
