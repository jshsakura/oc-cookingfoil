// Signs an account in on a server under test the way a browser does (the /login
// form with its CSRF token) and returns the headers its page's requests carry.
const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0];

/** { Cookie, Origin, "X-CSRF-Token" } of `name` signed in at `base`, the sign-in sent with `headers`; throws when it fails. */
export async function webSession(base, name, password, headers = {}) {
  const page = await fetch(`${base}/login`, { headers: { Accept: "text/html" } });
  const csrfCookie = cookieOf(page, "cf_csrf");
  if (!csrfCookie) throw new Error("no CSRF cookie from /login");
  const csrf = csrfCookie.split("=")[1];
  const res = await fetch(`${base}/login`, {
    method: "POST", redirect: "manual",
    headers: { ...headers, Cookie: csrfCookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: name, password, csrf, next: "/" }),
  });
  const user = cookieOf(res, "cf_user");
  if (res.status !== 303 || !user) throw new Error(`sign-in as ${name} failed: ${res.status}`);
  return { Cookie: `${csrfCookie}; ${user}`, Origin: base, "X-CSRF-Token": csrf };
}

/**
 * The headers of `name` signed in at /login and past the admin page's second
 * step with `adminPassword` (COOK_ADMIN_PASSWORD), as the admin page sends them.
 */
export async function adminSession(base, name, password, adminPassword) {
  const web = await webSession(base, name, password);
  const res = await fetch(`${base}/admin/verify`, {
    method: "POST", headers: { ...web, "Content-Type": "application/json" }, body: JSON.stringify({ password: adminPassword }),
  });
  const admin = cookieOf(res, "cf_admin");
  if (!admin) throw new Error(`admin sign-in as ${name} failed: ${res.status}`);
  return { ...web, Cookie: `${web.Cookie}; ${admin}` };
}
