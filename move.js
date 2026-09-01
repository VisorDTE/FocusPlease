const { execFileSync } = require("node:child_process")
const path = require("node:path")
const M = require(path.join(__dirname, "FocusPleaseModel.js"))

const workspaceId = String(process.argv[2] || "")
const addresses = process.argv.slice(3)
if (!workspaceId || !addresses.length) process.exit(0)

var i
for (i = 0; i < addresses.length; i++) {
  execFileSync("hyprctl", ["dispatch", M.moveCommand(addresses[i], workspaceId)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
}
