export function mountAiTeamPanel({ cards, input, openSettings, runLine }) {
  for (const card of cards) {
    if (card.id === "connectApiCard") {
      card.onclick = openSettings;
      continue;
    }
    card.onclick = () => {
      const command = card.dataset.cmd;
      const value = input.value.trim();
      if (!value) {
        input.placeholder = `先输入目标,再点「${card.querySelector(".qt").textContent}」…`;
        input.focus();
        return;
      }
      input.value = "";
      runLine(`/${command} ${value}`);
    };
  }
  return { update: () => {} };
}
