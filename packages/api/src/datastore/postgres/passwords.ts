import crypto from 'crypto';
import { promisify } from 'util';

// Match @hyperdx/passport-local-mongoose defaults so hashes remain portable
// if a deployment switches between Mongo and Postgres.
const ITERATIONS = 25000;
const KEYLEN = 512;
const DIGEST = 'sha256';
const SALT_LEN = 32;

const pbkdf2 = promisify(crypto.pbkdf2);

export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const derived = await pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derived = await pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST);
  const a = Buffer.from(hash, 'hex');
  const b = derived;
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
