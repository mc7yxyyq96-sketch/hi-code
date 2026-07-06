export function showRoute({ main, views, route, mainClass, activeNav, setActiveNav }) {
  if (mainClass) main.className = mainClass;
  for (const [name, element] of Object.entries(views)) {
    element.classList.toggle("hidden", name !== route);
  }
  if (typeof setActiveNav === "function" && activeNav) setActiveNav(activeNav);
}
