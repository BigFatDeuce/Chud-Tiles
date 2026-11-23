import { electronPlatform } from './electron';
import { webPlatform } from './web';
import type { Platform } from './types';

/** The platform this build runs on: the desktop bridge when present, the browser otherwise. */
export const platform: Platform = window.ct ? electronPlatform(window.ct) : webPlatform;
export type { Platform, Picked, PlatformCaps } from './types';
