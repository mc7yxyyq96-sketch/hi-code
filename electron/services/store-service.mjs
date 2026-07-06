import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createStoreService({
  listStoreCatalog,
  setStoreSource,
  previewStoreItem,
  installStoreItem,
  getStoreItemDetail,
  enableStoreItem,
  disableStoreItem,
  uninstallStoreItem,
}) {
  return {
    listStore(options) {
      return listStoreCatalog(ipcObject(options));
    },

    setStoreSource(sourceId) {
      return setStoreSource(ipcString(sourceId));
    },

    previewStoreItem(itemId) {
      return previewStoreItem(ipcString(itemId));
    },

    installStoreItem(itemId, options) {
      return installStoreItem(ipcString(itemId), ipcObject(options));
    },

    getStoreItemDetail(itemId) {
      return getStoreItemDetail(ipcString(itemId));
    },

    enableStoreItem(itemId) {
      return enableStoreItem(ipcString(itemId));
    },

    disableStoreItem(itemId) {
      return disableStoreItem(ipcString(itemId));
    },

    uninstallStoreItem(itemId) {
      return uninstallStoreItem(ipcString(itemId));
    },
  };
}

export function registerStoreIpc({ register, store }) {
  if (!register) throw new Error("registerStoreIpc requires register");
  if (!store) throw new Error("registerStoreIpc requires store service");

  register.handle("list-store", (_event, options) => store.listStore(options));
  register.handle("set-store-source", (_event, sourceId) => store.setStoreSource(sourceId));
  register.handle("preview-store-item", (_event, itemId) => store.previewStoreItem(itemId));
  register.handle("install-store-item", (_event, itemId, options) => store.installStoreItem(itemId, options));
  register.handle("store:item", (_event, itemId) => store.getStoreItemDetail(itemId));
  register.handle("store:enable", (_event, itemId) => store.enableStoreItem(itemId));
  register.handle("store:disable", (_event, itemId) => store.disableStoreItem(itemId));
  register.handle("store:uninstall", (_event, itemId) => store.uninstallStoreItem(itemId));
}
