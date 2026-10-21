// One-off probe: how does the deployed app / Vercel edge handle an oversized
// upload? Streams a 27 MB body to /api/documents/{id}/versions with a valid
// session and prints what comes back (status, error, or timeout) with timing.
// Not part of the suite; safe to delete.
const BASE = "https://trustvault-seven.vercel.app";
const EMAIL = "owner@trustvault.test";
const PASSWORD = "TrustVault!Demo2026";

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  console.log("login:", loginRes.status);

  // find any document owned by the owner
  const list = await fetch(`${BASE}/api/documents`, { headers: { cookie } });
  const docs = await list.json();
  const id = docs.documents?.[0]?.id;
  console.log("doc:", id, "list status:", list.status);
  if (!id) return;

  const body = new Uint8Array(27 * 1024 * 1024).fill(0x41);
  const boundary = "----probe";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.txt"\r\nContent-Type: text/plain\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.concat([head, Buffer.from(body), tail]);

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    console.log(`HUNG: no response after ${((Date.now() - started) / 1000).toFixed(1)}s -> aborting`);
    process.exit(2);
  }, 25000);
  try {
    const res = await fetch(`${BASE}/api/documents/${id}/versions`, {
      method: "POST",
      headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: payload,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = (await res.text()).slice(0, 300);
    console.log(`response: HTTP ${res.status} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log("body:", text);
  } catch (err) {
    clearTimeout(timer);
    console.log(`fetch error after ${((Date.now() - started) / 1000).toFixed(1)}s:`, String(err));
    console.log("cause:", String(err.cause ?? "none"));
  }
}
main();
