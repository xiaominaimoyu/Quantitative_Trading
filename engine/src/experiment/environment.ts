/**
 * Environment snapshot and version constants (P0-4).
 */

/** Engine package version; bump on every release. */
export const ENGINE_VERSION = '0.1.0';

/**
 * Capture the runtime environment of the current process.
 *
 * The snapshot is part of every {@link !ExperimentRecord} so that "same
 * result" claims can be qualified by "same runtime".
 *
 * @returns Frozen environment description.
 */
export function captureEnvironment(): {
  runtime: 'node';
  nodeVersion: string;
  platform: string;
  arch: string;
  engineVersion: string;
  timezone: 'UTC';
} {
  return Object.freeze({
    runtime: 'node',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    engineVersion: ENGINE_VERSION,
    timezone: 'UTC' as const,
  });
}
