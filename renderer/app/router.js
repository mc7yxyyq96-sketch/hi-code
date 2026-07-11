export function showRoute({ main, views, route, mainClass, activeNav, setActiveNav }) {
  const shell = globalThis.window?.hicodeAppShell;
  if (shell?.ownsNavigation && typeof shell.applyLegacyRoute === "function") {
    const result = shell.applyLegacyRoute({ route, mainClass, activeNav });
    if (typeof setActiveNav === "function" && activeNav) setActiveNav(activeNav);
    return result;
  }
  if (mainClass) main.className = mainClass;
  for (const [name, element] of Object.entries(views)) {
    element.classList.toggle("hidden", name !== route);
  }
  if (typeof setActiveNav === "function" && activeNav) setActiveNav(activeNav);
  return { routeId: route, panelId: route, navId: activeNav || "" };
}
