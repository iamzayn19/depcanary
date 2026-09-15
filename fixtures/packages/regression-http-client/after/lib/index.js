async function ping() {
  return fetch("https://api.example.com/health");
}
module.exports = { ping };
