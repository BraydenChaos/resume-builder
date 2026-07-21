export async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}
export async function postJSON(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
