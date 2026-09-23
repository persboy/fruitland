import bcrypt from "bcryptjs";
import { getEnv } from "../env";

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, getEnv().PASSWORD_HASH_ROUNDS);
}

export async function comparePassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}
