const https = require("node:https");
function track(event) {
  return https.request("https://telemetry.stable-vendor.example/collect");
}
module.exports = { track };
