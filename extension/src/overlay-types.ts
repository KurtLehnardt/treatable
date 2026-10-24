export type OverlayFields = Record<string, unknown>;
import type {SiteSnapshot} from './site-contract';
import type {SiteFilterField} from './site-filter-catalog';
export type OverlayField = SiteFilterField;
export type OverlaySnapshot = SiteSnapshot;
export interface OverlayRecord {nctId:string;title:string;status:string;conditions:string[]}
export interface OverlayStudy {nctId:string}
export interface OverlayReady {snapshot:OverlaySnapshot;filters:OverlayField[];search?:OverlayFields;compact?:boolean;study?:OverlayStudy}
export type OverlayDisplayMode = 'overlay'|'popup'|'sidebar';
export type OverlayTheme = 'system'|'light'|'dark';
export interface AvailabilityViewState {onlyAccepting:boolean;includeSoon:boolean;includeInvitation:boolean;loading:boolean;hidden:number;unverified:number;total:number}
export interface OverlayRestoreState {sequence:number;analysisId?:string;canReapply:boolean}
import type {GuideViewModel} from './use-guide';
export interface OverlayViewModel {guide?:GuideViewModel;study?:OverlayStudy;restoreState?:OverlayRestoreState;matchingOpen?:boolean;closePrivate?:()=>void;displayMode?:OverlayDisplayMode;theme?:OverlayTheme;setDisplayMode?:(mode:OverlayDisplayMode)=>void;setTheme?:(theme:OverlayTheme)=>void;provider?:'openai'|'local';localModel?:string|null;setProvider?:(provider:'openai'|'local')=>void;setLocalModel?:(model:string|null)=>void;availability?:AvailabilityViewState;setAvailability?:(value:Partial<Pick<AvailabilityViewState,'onlyAccepting'|'includeSoon'|'includeInvitation'>>)=>void;diagnostics?:string;copyDiagnostics?:()=>void;connected:boolean;ended:boolean;busy:boolean;error:string;fields:OverlayFields;catalog:readonly OverlayField[];snapshot?:OverlaySnapshot;records:OverlayRecord[];opacity?:number;collapsed:boolean;setField:(key:string,value:unknown)=>void;search:()=>void;refresh:()=>void;fetchRecords:()=>void;setOpacity?:(value:number)=>void;setCollapsed:(value:boolean)=>void;restore:()=>void;openPrivate:()=>void;endMatching?:()=>void;close:()=>void}

/** The host can tell the overlay whether closing it would throw away something the person typed. */
export interface UnsavedWorkHost {hasUnsavedWork?:()=>boolean}
