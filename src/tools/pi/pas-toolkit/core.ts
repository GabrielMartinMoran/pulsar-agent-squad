/**
 * Type-checking shim for the Pi adapter.
 *
 * Core-sharing approach (a): the canonical PAS state logic lives only in
 * `src/tools/pas-toolkit.ts`. This committed file re-exports it so tests and
 * type-checking can resolve `./core.ts` without duplicating state rules. The
 * build step replaces this shim with a byte copy of the canonical source in
 * the assembled extension directory, keeping a single source of truth.
 */
export * from '../../pas-toolkit.ts';
