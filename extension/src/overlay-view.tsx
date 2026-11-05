import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import type {OverlayViewModel,OverlayTheme,UnsavedWorkHost} from './overlay-types';
import {closeDiscardDialog,confirmDiscard} from './confirm-close';
function useResolvedTheme(theme: OverlayTheme) {
 const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(() => {
  if (typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => setSystemDark(media.matches);
  update(); media.addEventListener?.('change', update);
  return () => media.removeEventListener?.('change', update);
 }, []);
 return theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
}
function SettingsIcon() {return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.2-1.8 1-2.2-.6-2.5 4.3 1.7 1.6v2l-1.7 1.6 2.5 4.3 2.2-.6 1.8 1 .6 2.2h5l.6-2.2 1.8-1 2.2.6 2.5-4.3-1.7-1.6v-2l1.7-1.6-2.5-4.3-2.2.6-1.8-1L14.5 3z"/><circle cx="12" cy="12" r="3"/></svg>}
/** `ranking` is the AI-matched results section for a results page; `apply` is the study brief. */
export function OverlayView({vm, apply, settings, ranking}: {vm: OverlayViewModel & UnsavedWorkHost; apply?: ReactNode; settings?: ReactNode; ranking?: ReactNode}) {
 const [settingsOpen, setSettingsOpen] = useState(false);
 const displayMode = vm.displayMode || 'popup', theme = vm.theme || 'system', resolvedTheme = useResolvedTheme(theme);
 const latest = useRef(vm), confirming = useRef(false), alive = useRef(true), themeNow = useRef(resolvedTheme);
 latest.current = vm; themeNow.current = resolvedTheme;
 /* Closing ends the session and clears what was typed. Ask first only when there is something to lose; otherwise close at once. */
 const requestClose = useRef(async () => {
  const host = latest.current;
  if (confirming.current) return;
  if (!host.hasUnsavedWork?.()) {host.close(); return}
  confirming.current = true;
  /* A collapsed frame is too small for the dialog: expand it while asking, and collapse it again if the person keeps working. */
  const wasCollapsed = host.collapsed;
  if (wasCollapsed) host.setCollapsed(false);
  /* The intro tour shows its steps with the same dialog library. Stop it so the two dialogs never replace or close each other. */
  if (host.guide?.active) host.guide.stop();
  try {
   if (await confirmDiscard({theme: themeNow.current})) latest.current.close();
   else if (wasCollapsed && alive.current && !latest.current.ended) latest.current.setCollapsed(true);
  } catch {latest.current.close()} finally {confirming.current = false}
 }).current;
 /* Leaving the study for the website's search page clears this study's drafts, so ask first, with the same rule as Close, when there is typed work. */
 const requestOpenSearch = useRef(async () => {
  const host = latest.current;
  if (confirming.current) return;
  if (!host.hasUnsavedWork?.()) {host.guide?.openSearch(); return}
  confirming.current = true;
  if (host.guide?.active) host.guide.stop();
  try {
   if (await confirmDiscard({theme: themeNow.current, title: 'Leave this study and clear what you typed?', text: 'Going to the ClinicalTrials.gov search page ends this study session. The details, drafts and notes you typed here are cleared and cannot be brought back. Nothing is saved.', confirmText: 'Leave and clear'})) latest.current.guide?.openSearch();
  } catch {/* Stay on the study. */} finally {confirming.current = false}
 }).current;
 useEffect(() => {alive.current = true; return () => {alive.current = false; closeDiscardDialog()}}, []);
 /* A press on the website outside the popup. Nothing typed: the usual close, at once. Something typed: hide instead, without asking and
  * without clearing anything, so the toolbar button can bring it all back. If the hide is refused, the usual close runs instead, and it
  * asks before clearing. A press while the discard question is showing, while a hide is on its way, in the sidebar or after the session
  * ended does nothing. Whether the frame is collapsed is not checked here: the page and the background own that and send nothing while it
  * is, and the page itself sends nothing while its own guide steps run. */
 const hiding = useRef(false);
 useEffect(() => vm.onOutsideClick?.(() => {
  const host = latest.current;
  if (confirming.current || hiding.current || host.ended || (host.displayMode || 'popup') !== 'popup') return;
  if (!host.hasUnsavedWork?.() || !host.hide) {void requestClose(); return}
  hiding.current = true;
  void host.hide().catch(() => false).then(hidden => {hiding.current = false; if (!hidden && alive.current && !latest.current.ended) void requestClose()});
 }), [vm.onOutsideClick]);
 useEffect(() => {if (vm.ended) closeDiscardDialog()}, [vm.ended]);
 useEffect(() => {const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); if (confirming.current || event.repeat) return; if (settingsOpen) setSettingsOpen(false); else void requestClose()}}; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)}, [settingsOpen]);
 return <main data-theme={resolvedTheme} data-display-mode={displayMode} role={displayMode === 'popup' ? 'dialog' : undefined} aria-modal={displayMode === 'popup' ? true : undefined} aria-label={displayMode === 'popup' ? 'Treatable study assistant' : undefined} className={`site-overlay${vm.collapsed ? ' is-collapsed' : ''}`}>
  <header className="overlay-header"><div className="overlay-brand"><span className="brand-symbol" aria-hidden="true">t</span><div><span className="eyebrow">Your study companion</span><h1>Treatable</h1></div></div><div className="header-actions"><button type="button" className="icon-button settings-button" data-treatable-guide="appearance" aria-label="Treatable settings" aria-expanded={settingsOpen} aria-controls="treatable-settings" onClick={() => setSettingsOpen(!settingsOpen)}><SettingsIcon/></button><button type="button" className="icon-button" aria-label={vm.collapsed ? 'Expand search assistant' : 'Collapse search assistant'} onClick={() => vm.setCollapsed(!vm.collapsed)}>{vm.collapsed ? '↗' : '−'}</button><button type="button" className="icon-button" aria-label="Close Treatable and end session" onClick={() => void requestClose()}>×</button></div></header>
  {settingsOpen && <section id="treatable-settings" className="display-settings" aria-label="Treatable display settings"><div className="settings-heading"><h2>Make yourself comfortable.</h2><button type="button" className="quiet" onClick={() => setSettingsOpen(false)}>Done</button></div><div className="settings-grid"><label>Display<select value={displayMode} onChange={event => vm.setDisplayMode?.(event.target.value as typeof displayMode)}><option value="popup">Popup</option><option value="sidebar">Sidebar</option></select></label><label>Theme<select value={theme} onChange={event => vm.setTheme?.(event.target.value as OverlayTheme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><p>Popup centers the assistant. Clicking the website outside it closes it, or only hides it while you have typed details or a draft; the toolbar button then shows a dot and brings it back. While it is hidden, AI-matched results pause and nothing is sent, and if the website moves to another study or results page, that page’s study drafts start over (your details stay). Sidebar stays beside this website, which narrows to make room when the window is wide enough. Your display, theme and AI-matched results choices are remembered on this device. Searches and health details are never saved.</p>{settings}</section>}
  <div className="session-line"><span className={`connection-dot${vm.connected ? ' connected' : ''}`} aria-hidden="true"/><span role="status">{vm.ended ? 'Session ended' : vm.connected ? 'Connected to this ClinicalTrials.gov tab' : 'Click the Treatable button in the toolbar to start'}</span><span className="scope-label">{vm.study ? 'This study page' : 'Current results page'}</span></div>
  {vm.setAiRanking && <div className="ai-switch-row"><label className="ai-switch" data-treatable-guide="ai-ranking"><input type="checkbox" role="switch" checked={vm.aiRanking !== 'off'} disabled={vm.ended} onChange={event => vm.setAiRanking?.(event.target.checked ? 'on' : 'off')}/><span><strong>AI-matched results</strong><small>{vm.aiRanking !== 'off' ? 'On: results pages show best matches first, with a match % on each card.' : 'Off: results pages keep the website’s own order.'}</small></span></label></div>}
  {!vm.collapsed && <><div className="overlay-content">{ranking}{apply}{vm.study&&vm.guide&&<div className="search-elsewhere"><button type="button" className="quiet" disabled={!vm.connected||vm.ended} onClick={() => void requestOpenSearch()}>Search for other studies on ClinicalTrials.gov</button></div>}
   {vm.error && <p role="alert" className="notice error">{vm.error}</p>}
   </div><footer className="overlay-footer"><p>Raw profiles stay out of the website’s DOM.</p>{vm.guide&&<button type="button" className="quiet" data-treatable-guide="replay" disabled={!vm.connected||vm.guide.active} onClick={vm.guide.replayIntro}>Replay intro</button>}</footer></>}
 </main>;
}
