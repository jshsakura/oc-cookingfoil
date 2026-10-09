import _ from "lodash";

import { authUsers } from "./helpers/envs.js";
import debug from "./debug.js";

// Only the first colon separates name and password; passwords may contain ':'.
function parseUserString(authString) {
  const sep = authString.indexOf(":");
  return { name: authString.slice(0, sep).trim(), pass: authString.slice(sep + 1).trim() };
}

export function getUsersFromEnv() {
  let parsedUsers = null;
  if (!_.isNil(authUsers?.length)) {
    if (authUsers.includes(",") && authUsers.includes(":")) {
      if (authUsers.split(",").length > 0) {
        parsedUsers = authUsers
          .split(",")
          .map(parseUserString);
      }
    } else if (authUsers.includes(":")) {
      parsedUsers = [parseUserString(authUsers)];
    }

    debug.log(
      "Auth Users Loaded: %O",
      parsedUsers.map((value) => value.name).join(",")
    );
    if (parsedUsers?.length) {
      // transform this [ { name: admin, pass: 123 } ] to this -> { admin: 123 }
      parsedUsers = parsedUsers.reduce(function (accumulator, user) {
        return _.merge(accumulator ?? {}, { [user.name]: user.pass });
      }, {});
    }
  }
  return parsedUsers;
}
