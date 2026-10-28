import { atcoder } from './atcoder';
import { codeforces } from './codeforces';
import type { Platform } from './platform';

export const PLATFORMS: Platform[] = [codeforces, atcoder];

export function platformForUrl(url: string | undefined): Platform | null {
  if (!url) return null;
  return PLATFORMS.find((p) => p.isProblemUrl(url)) ?? null;
}

export function platformById(id: string): Platform {
  return PLATFORMS.find((p) => p.id === id)!;
}

export type { Platform };
