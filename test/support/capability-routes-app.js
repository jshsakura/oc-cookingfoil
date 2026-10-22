// A small app that registers routes in every way the old text parser of src/index.js missed
// (factories that take arguments or are not named *Router, routers held in variables or built by
// helpers, app.route(), router.all(), options and head). test/unit/capability-discovery.test.js
// runs it through discoverRoutes() and expects each one.
import express from "express";

const h = (_req, res) => res.end();
const app = express();

const extra = express.Router();
extra.get("/api/e1", h);
app.use(extra);

app.route("/api/e4").get(h).post(h);

function mk() {
  const r = express.Router();
  r.put("/api/e3", h);
  return r;
}
app.use(mk());

function votes(options) {
  const r = express.Router();
  r.all("/e5", h);
  r.delete("/e11", (req, res) => res.json(options));
  return r;
}
app.use("/api", votes({ a: 1 }));

const mkApi = () => {
  const r = express.Router();
  r.patch("/e12", h);
  return r;
};
app.use("/api", mkApi());

app.options("/api/e13", h);
app.head("/api/e13", h);

const v14 = express.Router();
v14.get("/", h);
app.use("/api/e14", v14);

app.listen(0);
