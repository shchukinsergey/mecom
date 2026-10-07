import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountUser } from "../src/online/roomTypes.ts";
import { RoomDatabase } from "./roomDatabase.ts";
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sessionToken(req: IncomingMessage): string {
  const tokens = (req.headers.cookie ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith("mecom_session="));
  return tokens.length === 1 ? tokens[0].slice(14) : "";
}
export function authenticated(
  req: IncomingMessage,
  db: RoomDatabase,
): AccountUser {
  const token = sessionToken(req);
  const user = /^[A-Za-z0-9_-]{43}$/.test(token)
    ? db.session(tokenHash(token))
    : undefined;
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}
// Reject excess work instead of accumulating an unbounded scrypt queue.
let activeHashes = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (activeHashes >= 2) throw new HttpError(429, "Authentication busy");
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  } finally {
    activeHashes--;
  }
}
export class Authentication {
  private readonly peerAttempts = new Map<
    string,
    { count: number; until: number }
  >();
  private readonly loginAttempts = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    private readonly db: RoomDatabase,
    private readonly secure: boolean,
  ) {}
  private limit(
    attempts: Map<string, { count: number; until: number }>,
    key: string,
    maximum: number,
  ): void {
    const now = Date.now();
    for (const [expiredKey, value] of attempts)
      if (value.until <= now) attempts.delete(expiredKey);
    let value = attempts.get(key);
    if (!value) {
      if (attempts.size >= 4096)
        throw new HttpError(429, "Too many attempts");
      value = { count: 0, until: now + 60000 };
      attempts.set(key, value);
    }
    if (++value.count > maximum) throw new HttpError(429, "Too many attempts");
  }
  async credentials(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
    register: boolean,
  ): Promise<AccountUser> {
    // Only the socket peer is trusted; ingress headers may be client-supplied.
    // This generous aggregate cap allows distinct users behind a shared ingress.
    this.limit(this.peerAttempts, req.socket.remoteAddress ?? "unknown", 300);
    const { login, password } = body;
    if (
      Object.keys(body).some((k) => !["login", "password"].includes(k)) ||
      typeof login !== "string" ||
      !/^[A-Za-z0-9_-]{3,32}$/.test(login) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128 ||
      Buffer.byteLength(password) > 256
    )
      throw new HttpError(400, "Invalid credentials format");
    const loginKey = login.toLowerCase();
    this.limit(this.loginAttempts, loginKey, 10);
    let user = this.db.user(login);
    if (register) {
      if (user) throw new HttpError(409, "Login already exists");
      const salt = randomBytes(32).toString("hex");
      const passwordHash = (await derive(password, salt)).toString("hex");
      user = { id: randomUUID(), login, salt, passwordHash };
      this.db.transaction(() => {
        if (this.db.user(login))
          throw new HttpError(409, "Login already exists");
        this.db.addUser(user!);
      });
    } else {
      const key = await derive(password, user?.salt ?? "0".repeat(64));
      if (!user || !timingSafeEqual(key, Buffer.from(user.passwordHash, "hex")))
        throw new HttpError(401, "Invalid login or password");
    }
    const token = randomBytes(32).toString("base64url");
    this.db.addSession(tokenHash(token), user.id);
    this.cookie(res, token, 30 * 86400);
    this.loginAttempts.delete(loginKey);
    return { id: user.id, login: user.login };
  }
  logout(req: IncomingMessage, res: ServerResponse): void {
    this.db.removeSession(tokenHash(sessionToken(req)));
    this.cookie(res, "", 0);
  }
  private cookie(res: ServerResponse, token: string, maxAge: number): void {
    res.setHeader(
      "Set-Cookie",
      `mecom_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.secure ? "; Secure" : ""}`,
    );
  }
}
