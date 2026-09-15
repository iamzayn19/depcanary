const { spawn } = require("node:child_process");
function run(cmd, args) {
  return spawn(cmd, args, { stdio: "inherit" });
}
module.exports = { run };
