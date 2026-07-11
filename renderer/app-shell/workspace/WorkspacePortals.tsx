import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceController } from "./controller.ts";
import { Conversation } from "./Conversation.tsx";
import { Inspector } from "./Inspector.tsx";
import { SessionSidebar } from "./SessionSidebar.tsx";
import type { WorkspaceStore } from "./store.ts";
import { Timeline } from "./Timeline.tsx";

interface WorkspacePortalsProps {
  controller: WorkspaceController;
  store: WorkspaceStore;
}

function requiredMount(id: string) {
  const mount = document.getElementById(id);
  if (!mount) throw new Error(`Workspace React mount #${id} is missing`);
  return mount;
}

function DrawerControls({ store }: { store: WorkspaceStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const timelineButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  const previousDrawer = useRef(state.drawer);

  useEffect(() => {
    document.body.classList.toggle("timeline-drawer-open", state.drawer === "timeline");
    document.body.classList.toggle("diff-drawer-open", state.drawer === "inspector");
    if (state.drawer !== "none") {
      const panel = document.getElementById(state.drawer === "timeline" ? "timelinePanel" : "diffPanel");
      panel?.setAttribute("tabindex", "-1");
      panel?.focus();
    } else if (previousDrawer.current === "timeline") timelineButton.current?.focus();
    else if (previousDrawer.current === "inspector") inspectorButton.current?.focus();
    previousDrawer.current = state.drawer;
  }, [state.drawer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && store.getSnapshot().drawer !== "none") {
        event.preventDefault();
        store.setDrawer("none");
      }
    };
    const media = window.matchMedia("(min-width: 1181px)");
    const onWide = () => { if (media.matches) store.setDrawer("none"); };
    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onWide);
    };
  }, [store]);

  return (
    <>
      <div className="workbench-mobile-tabs" aria-label="工作台面板" data-workspace-owner="react">
        <button ref={timelineButton} id="timelineDrawerBtn" className="mini-btn workbench-drawer-toggle" type="button" aria-controls="timelinePanel" aria-expanded={state.drawer === "timeline"} onClick={() => store.setDrawer(state.drawer === "timeline" ? "none" : "timeline")}><span className="i-stack" /> 时间线</button>
        <button ref={inspectorButton} id="diffDrawerBtn" className="mini-btn workbench-drawer-toggle workbench-diff-toggle" type="button" aria-controls="diffPanel" aria-expanded={state.drawer === "inspector"} onClick={() => store.setDrawer(state.drawer === "inspector" ? "none" : "inspector")}><span className="i-stack" /> 改动</button>
      </div>
      <button id="workbenchDrawerBackdrop" className="workbench-drawer-backdrop" type="button" aria-label="关闭工作台面板" onClick={() => store.setDrawer("none")} />
      {state.actionError ? <div className="workspace-action-error" role="alert"><span>{state.actionError}</span><button type="button" aria-label="关闭工作区错误" onClick={() => store.setActionError("")}>×</button></div> : null}
    </>
  );
}

export function WorkspacePortals({ controller, store }: WorkspacePortalsProps) {
  const mounts = {
    sessions: requiredMount("sessions"),
    conversation: requiredMount("chat"),
    controls: requiredMount("workbenchControlsMount"),
    timeline: requiredMount("timelineWorkspaceMount"),
    inspector: requiredMount("inspectorWorkspaceMount"),
  };
  return (
    <>
      {createPortal(<SessionSidebar controller={controller} store={store} />, mounts.sessions)}
      {createPortal(<Conversation store={store} />, mounts.conversation)}
      {createPortal(<DrawerControls store={store} />, mounts.controls)}
      {createPortal(<Timeline controller={controller} store={store} />, mounts.timeline)}
      {createPortal(<Inspector controller={controller} store={store} />, mounts.inspector)}
    </>
  );
}
