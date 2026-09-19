import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package name and version, read at runtime so every entry point reports the same values. */
export const PACKAGE = require("../package.json") as { name: string; version: string };
export const PACKAGE_NAME: string = PACKAGE.name;
export const VERSION: string = PACKAGE.version;
