import express from "express";
import { fileURLToPath } from "node:url";
export default express.static(fileURLToPath(new URL("../views/assets/", import.meta.url)), {
  index: false,
  maxAge: "1h",
  fallthrough: false,
});
