import type { APIRequestContext } from '@playwright/test';

const cookieOf = (headers: { name: string; value: string }[], name: string) =>
  headers.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).find((c) => c.startsWith(`${name}=`));

/** Signs `name` in at /login the way the form does and returns the Cookie and CSRF token its page's requests carry, or null. */
export async function webSession(request: APIRequestContext, name: string, password: string) {
  const csrfCookie = cookieOf((await request.get('/login', { headers: { Accept: 'text/html' } })).headersArray(), 'cf_csrf');
  if (!csrfCookie) return null;
  const csrf = csrfCookie.split('=')[1];
  const res = await request.post('/login', { form: { username: name, password, csrf, next: '/' }, headers: { Cookie: csrfCookie }, maxRedirects: 0 });
  const user = cookieOf(res.headersArray(), 'cf_user');
  return user ? { cookie: `${csrfCookie}; ${user}`, csrf } : null;
}

/** Removes the account `name` with the admin session `adminCookie`, signed in as `name`; a no-op when it is already gone. */
export async function removeAccount(request: APIRequestContext, name: string, password: string, adminCookie: string) {
  const web = await webSession(request, name, password);
  const cookie = web ? `${adminCookie}; ${web.cookie}` : adminCookie;
  await request.delete(`/admin/api/users/${name}?allowEmpty=1`, { headers: { Cookie: cookie, 'X-CSRF-Token': web?.csrf ?? '' } }).catch(() => {});
}
