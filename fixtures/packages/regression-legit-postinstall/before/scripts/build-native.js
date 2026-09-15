const { execSync } = require("node:child_process");
execSync("node-gyp rebuild", { stdio: "inherit" });
