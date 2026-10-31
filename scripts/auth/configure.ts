import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";

async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf("--url");
  const url = new URL(urlIndex >= 0 ? args[urlIndex + 1] : "http://127.0.0.1:3000");
  if (!['http:', 'https:'].includes(url.protocol) || (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error("Use an origin URL; non-loopback access requires HTTPS.");
  }
  const file = ".env.local";
  const previous = await readFile(file, "utf8");
  const existing = parse(previous);
  const secret = existing.BETTER_AUTH_SECRET?.length >= 32 ? existing.BETTER_AUTH_SECRET : randomBytes(48).toString("base64url");
  const retained = previous.split(/\r?\n/).filter((line) => !/^(GEO_AUTH_MODE|BETTER_AUTH_URL|BETTER_AUTH_SECRET)=/.test(line));
  const content = [...retained, 'GEO_AUTH_MODE=invite', `BETTER_AUTH_URL=${url.origin}`, `BETTER_AUTH_SECRET=${secret}`, ''].join('\n');
  await writeFile(file, content, { mode: 0o600 });
  console.log('Invitation mode configured in ignored .env.local; secret retained/generated without being printed. Restart the application.');
}

main().catch(() => { console.error('Could not configure invitation mode. Ensure .env.local exists and the URL is valid.'); process.exitCode = 1; });
