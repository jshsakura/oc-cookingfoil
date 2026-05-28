import debug from "debug";

var log = debug("oc-cookingfoil");
var http = debug("oc-cookingfoil:request");
var file = debug("oc-cookingfoil:file");
var ftp = debug("oc-cookingfoil:ftp");
var error = debug("oc-cookingfoil:err");

export default {
  http,
  file,
  log,
  ftp,
  error,
};
