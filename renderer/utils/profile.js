export function buildUserProfile(user, { localLabel = "本地账号" } = {}) {
  if (!user?.email && !user?.name) {
    return {
      displayName: "Hi Code 用户",
      handle: localLabel,
      emailLine: "未登录 · 可跳过登录本地使用",
      initials: "HC",
      badge: "本地版",
      avatarHue: 210,
    };
  }

  const email = String(user.email || "").trim();
  const displayName = String(user.name || email.split("@")[0] || "Hi Code").trim();
  const handle = email ? `@${email.split("@")[0]}` : localLabel;

  return {
    displayName,
    handle,
    emailLine: email || localLabel,
    initials: initialsFromName(displayName),
    badge: "已登录",
    avatarHue: hashHue(displayName + email),
  };
}

export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const compact = String(name || "H").trim();
  return compact.length >= 2 ? compact.slice(0, 2).toUpperCase() : `${compact[0] || "H"}`.toUpperCase();
}

function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return 200 + (hash % 80);
}
