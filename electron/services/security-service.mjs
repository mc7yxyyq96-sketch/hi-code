import fs from "node:fs";
import path from "node:path";
import { ipcObject, redactSensitive } from "../ipc/ipc-utils.mjs";

export { redactSensitive };

export function pathInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function createPathGuard({ roots }) {
  const resolvedRoots = (roots || []).map((root) => {
    try {
      return fs.realpathSync.native(root);
    } catch {
      return path.resolve(root);
    }
  });
  return {
    assertInside(candidate) {
      const target = (() => {
        try {
          return fs.realpathSync.native(candidate);
        } catch {
          return path.resolve(candidate);
        }
      })();
      if (!resolvedRoots.some((root) => pathInside(root, target))) {
        return { ok: false, error: "path escapes allowed roots" };
      }
      return { ok: true, path: target };
    },
  };
}

export function createSecurityService({ currentAuthUser, registerUser, loginUser, logoutUser, logger = null }) {
  return {
    authStatus() {
      return { user: currentAuthUser() };
    },
    register(payload) {
      return registerUser(ipcObject(payload));
    },
    login(payload) {
      return loginUser(ipcObject(payload));
    },
    logout() {
      return logoutUser();
    },
    log(event, payload) {
      if (typeof logger === "function") logger(event, redactSensitive(payload));
    },
    redactSensitive,
  };
}

export function registerSecurityIpc({ register, security }) {
  if (!register) throw new Error("registerSecurityIpc requires register");
  if (!security) throw new Error("registerSecurityIpc requires security service");

  register.handle("auth-status", () => security.authStatus());
  register.handle("register", (_event, payload) => security.register(payload));
  register.handle("login", (_event, payload) => security.login(payload));
  register.handle("logout", () => security.logout());
}
