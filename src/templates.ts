// Rig templates: the kinds of creature the creature presets know how to move. A template is a
// list of roles (body, head, near leg, ...); rigging means giving parts roles, and every preset
// for that template then works on the model. Missing roles are skipped.

import type { Part } from './rig';

export type TemplateKind = 'biped' | 'quadruped' | 'shell';
export type Facing = 'right' | 'left';

export interface RigTemplate {
  kind: TemplateKind | null;
  facing: Facing;
}

export const TEMPLATES: Record<TemplateKind, { name: string; help: string; roles: [string, string][] }> = {
  biped: {
    name: 'Biped (side view)',
    help: 'Two legs: people, robots, birds standing up.',
    roles: [
      ['body', 'Body'],
      ['head', 'Head'],
      ['arm.near', 'Near arm'],
      ['arm.far', 'Far arm'],
      ['leg.near', 'Near leg'],
      ['leg.far', 'Far leg'],
      ['tail', 'Tail'],
    ],
  },
  quadruped: {
    name: 'Four-legged (side view)',
    help: 'Dogs, cats, horses, lizards.',
    roles: [
      ['body', 'Body'],
      ['head', 'Head'],
      ['leg.front.near', 'Near front leg'],
      ['leg.front.far', 'Far front leg'],
      ['leg.back.near', 'Near back leg'],
      ['leg.back.far', 'Far back leg'],
      ['tail', 'Tail'],
    ],
  },
  shell: {
    name: 'Shell creature (side view)',
    help: 'Turtles, tortoises, snails: legs and head that hide in a shell.',
    roles: [
      ['body', 'Shell'],
      ['head', 'Head'],
      ['leg.front.near', 'Near front leg'],
      ['leg.front.far', 'Far front leg'],
      ['leg.back.near', 'Near back leg'],
      ['leg.back.far', 'Far back leg'],
      ['tail', 'Tail'],
    ],
  },
};

export const roleLabel = (kind: TemplateKind | null, role: string) => (kind && TEMPLATES[kind].roles.find(([r]) => r === role)?.[1]) || role;

/** What creature presets read from the rig. */
export interface RigCtx {
  /** +1 when the creature faces right (+X), -1 when it faces left. */
  facing: 1 | -1;
  part: (role: string) => string | undefined;
  pivot: (partId: string) => [number, number];
}

export const emptyCtx: RigCtx = { facing: 1, part: () => undefined, pivot: () => [0, 0] };

export function rigCtx(parts: Part[], tpl: RigTemplate): RigCtx {
  return {
    facing: tpl.facing === 'left' ? -1 : 1,
    part: (role) => parts.find((p) => p.role === role)?.id,
    pivot: (id) => parts.find((p) => p.id === id)?.pivot ?? [0, 0],
  };
}

/**
 * Guess roles from part names, Z and pivots, and which way the creature faces from where its head
 * is. Far parts are the ones named "far" or set behind the body; front legs are on the facing side.
 */
export function guessRoles(kind: TemplateKind, parts: Part[]): { roles: Map<string, string>; facing: Facing } {
  const has = (p: Part, ...words: string[]) => words.some((w) => p.name.toLowerCase().includes(w));
  const far = (p: Part) => has(p, 'far') || p.z < 0;
  const body =
    parts.find((p) => has(p, kind === 'shell' ? 'shell' : 'body', 'body', 'torso', 'chest', 'trunk', 'shell')) ?? parts.find((p) => !p.parent) ?? parts[0];
  const head = parts.find((p) => p !== body && has(p, 'head', 'face', 'skull'));
  const facing: Facing = head && head.pivot[0] < body.pivot[0] ? 'left' : 'right';
  const roles = new Map<string, string>();
  const give = (p: Part | undefined, role: string) => {
    if (p && ![...roles.values()].includes(role) && !roles.has(p.id)) roles.set(p.id, role);
  };
  give(body, 'body');
  give(head, 'head');
  give(parts.find((p) => !roles.has(p.id) && has(p, 'tail')), 'tail');
  const rest = parts.filter((p) => !roles.has(p.id));
  const belowBody = (p: Part) => p.pivot[1] >= body.pivot[1];
  if (kind === 'biped') {
    const arms = rest.filter((p) => has(p, 'arm', 'hand', 'wing') || (!has(p, 'leg', 'foot') && !belowBody(p)));
    const legs = rest.filter((p) => !arms.includes(p));
    give(arms.find((p) => !far(p)), 'arm.near');
    give(arms.find((p) => far(p)), 'arm.far');
    give(legs.find((p) => !far(p)), 'leg.near');
    give(legs.find((p) => far(p)), 'leg.far');
  } else {
    // front legs sit on the side the creature faces
    const front = (p: Part) => (p.pivot[0] - body.pivot[0]) * (facing === 'left' ? -1 : 1) > 0 || has(p, 'front', 'fore');
    const legs = rest.filter((p) => !has(p, 'head', 'tail'));
    for (const p of legs) {
      const role = `leg.${front(p) && !has(p, 'back', 'hind') ? 'front' : 'back'}.${far(p) ? 'far' : 'near'}`;
      give(p, role);
    }
  }
  return { roles, facing };
}
