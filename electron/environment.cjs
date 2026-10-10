const path = require("node:path");

// Finder launches with a smaller PATH than an interactive shell.
module.exports = {
  ...process.env,
  PATH: [
    ...new Set([
      ...(process.env.PATH || "/usr/bin:/bin").split(path.delimiter),
      "/Library/TeX/texbin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]),
  ].join(path.delimiter),
};
