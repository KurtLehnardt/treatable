import type {SiteSnapshot} from './site-contract';
export type OverlaySnapshot = SiteSnapshot;
export interface OverlayStudy {nctId:string}
export interface OverlayReady {snapshot:OverlaySnapshot;compact?:boolean;study?:OverlayStudy}
export type OverlayDisplayMode = 'popup'|'sidebar';
export type OverlayTheme = 'system'|'light'|'dark';
import type {GuideViewModel} from './use-guide';
import type {AiRanking} from './ui-prefs';
/** hide keeps the frame and everything typed while the popup is out of the way; the toolbar button shows it again. hidden is true in
 * between, as the background reports it. onOutsideClick subscribes to presses on the page outside the popup, relayed by the background over
 * the authenticated port. */
export interface OverlayViewModel {aiRanking?:AiRanking;setAiRanking?:(value:AiRanking)=>void;guide?:GuideViewModel;study?:OverlayStudy;displayMode?:OverlayDisplayMode;theme?:OverlayTheme;setDisplayMode?:(mode:OverlayDisplayMode)=>void;setTheme?:(theme:OverlayTheme)=>void;provider?:'openai'|'local';localModel?:string|null;setProvider?:(provider:'openai'|'local')=>void;setLocalModel?:(model:string|null)=>void;connected:boolean;ended:boolean;busy:boolean;error:string;snapshot?:OverlaySnapshot;opacity?:number;collapsed:boolean;hidden?:boolean;setOpacity?:(value:number)=>void;setCollapsed:(value:boolean)=>void;restore:()=>void;close:()=>void;hide?:()=>Promise<boolean>;onOutsideClick?:(listener:()=>void)=>()=>void}

/** The host can tell the overlay whether closing it would throw away something the person typed. */
export interface UnsavedWorkHost {hasUnsavedWork?:()=>boolean}
