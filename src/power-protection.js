// Shared contact and material rules; this module has no simulation state imports.
export const PROTECTION_RATINGS = Object.freeze([4,8,16,32]);
export const FUSE_BUILD_COST = Object.freeze({alloy:2,components:1});
export const FUSE_BUILD_WORK = 6;
export const FUSE_REPLACEMENT_COST = Object.freeze({alloy:1});
export const FUSE_REPLACEMENT_WORK = 3;
export const isProtectionDevice = t => t?.building==='breaker'||t?.building==='fuseBox';
export const protectionClosed = t => !!(isProtectionDevice(t)&&t.protection?.enabled&&t.hp>0&&
  (t.building==='breaker'?!t.protection.tripped:!t.protection.blown));
