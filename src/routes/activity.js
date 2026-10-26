import express from "express";
import activity from "../tasks/activity.js";

// Everyone who can use the library can read its status. Commands stay on the admin API.
export default function activityRouter(registry = activity) {
  const router = express.Router();
  router.get("/", (_req, res) => res.set("Cache-Control", "no-store").json(registry.list()));
  return router;
}
