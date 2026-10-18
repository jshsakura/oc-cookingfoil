/**
 * Thresholds shared by the guards.
 *
 * COOK_AUTH_MAX_FAILURES used to be parsed independently in auth-guard and
 * access-guard, so bad credentials and probe hits could drift apart even though
 * they spend the same budget. One definition keeps them honest.
 */
import { envNumber, envBool } from "../helpers/env-read.js";

/** Failures (bad password OR probe) before an IP is locked out. */
export const maxAuthFailures = envNumber("COOK_AUTH_MAX_FAILURES", 5, {
  min: 1,
  integer: true,
});

/**
 * Loopback callers (you, your dev box, the docker host on bridge mode) skip
 * lockout/probe tracking — they already have local shell access. Set
 * COOK_LOCKOUT_TRUST_LOOPBACK=false to enforce strictly.
 */
export const trustLoopback = envBool("COOK_LOCKOUT_TRUST_LOOPBACK", true);
