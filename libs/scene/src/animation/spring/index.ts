/**
 * Spring-based physics simulation system for hair and cloth effects
 * @packageDocumentation
 */

export type { SpringParticle } from './spring_particle';
export { createSpringParticle } from './spring_particle';

export type { SpringConstraint } from './spring_constraint';
export { createSpringConstraint } from './spring_constraint';

export { SpringChain } from './spring_chain';
export { SpringSystem } from './spring_system';
export type { SpringSystemOptions } from './spring_system';

export { MultiChainSpringSystem } from './multi_chain_spring_system';
export type { MultiChainSpringSystemOptions, InterChainConstraint } from './multi_chain_spring_system';
