// electron-builder always filters node_modules out of extraResources, so the staged
// host (with its flat node_modules) is copied into the bundle here, before signing.
const { cpSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const source = path.join(context.packager.projectDir, "build", "host");
  cpSync(source, path.join(resources, "host"), { recursive: true, verbatimSymlinks: true });
};
