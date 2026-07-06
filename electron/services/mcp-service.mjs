export function createMcpService({ initMcp, loadConfig, listLocalPlugins, listLocalSkills, listConfiguredMcpServers, listLocalAgents = () => [] }) {
  return {
    async initializeConfiguredServers() {
      const cfg = loadConfig();
      if (Object.keys(cfg.mcpServers || {}).length) await initMcp(cfg.mcpServers).catch(() => {});
    },

    listCapabilities() {
      return {
        plugins: listLocalPlugins(),
        skills: listLocalSkills(),
        mcp: listConfiguredMcpServers(),
        agents: listLocalAgents(),
      };
    },
  };
}

export function registerMcpIpc({ register, mcp }) {
  if (!register) throw new Error("registerMcpIpc requires register");
  if (!mcp) throw new Error("registerMcpIpc requires mcp service");
  register.handle("list-capabilities", () => mcp.listCapabilities());
}
