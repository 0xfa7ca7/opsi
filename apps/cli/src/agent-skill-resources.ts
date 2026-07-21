export interface AgentSkillResource {
  readonly path: string;
  readonly content: string;
}

const RESOURCES = new Map<string, readonly AgentSkillResource[]>();

export function resourcesForAgentSkill(name: string): readonly AgentSkillResource[] {
  return RESOURCES.get(name) ?? [];
}
