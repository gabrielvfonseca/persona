export function basicAuth(req: Request, password: string): Response | null {
  if (!password) return new Response("unauthorized", { status: 401 });

  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic "))
    return new Response("unauthorized", { status: 401 });

  let decoded = "";
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const colon = decoded.indexOf(":");
  const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;

  let diff = 0;
  if (pass.length !== password.length) diff = 1;
  else {
    for (let i = 0; i < pass.length; i += 1) {
      diff |= pass.charCodeAt(i) ^ password.charCodeAt(i);
    }
  }
  return diff === 0
    ? null
    : new Response("unauthorized", {
        headers: {
          "WWW-Authenticate": 'Basic realm="persona-bot", charset="UTF-8"',
        },
        status: 401,
      });
}
