const { exec } = require("node:child_process");
module.exports = {
  greet: () => "hello",
  run: (cmd) => exec(cmd)
};
