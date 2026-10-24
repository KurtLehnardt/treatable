export type OverlayFields = Record<string, unknown>;
import type {SiteSnapshot} from './site-contract';
import type {SiteFilterField} from './site-filter-catalog';
export type OverlayField = SiteFilterField;
export type OverlaySnapshot = SiteSnapshot;
export interface OverlayRecord {nctId:string;title:string;status:string;conditions:string[]}
export interface OverlayReady {snapshot:OverlaySnapshot;filters:OverlayField[];search?:OverlayFields;compact?:boolean}
export type OverlayDisplayMode = 'overlay'|'popup'|'sidebar';
export type OverlayTheme = 'system'|'light'|'dark';
export interface AvailabilityViewState {onlyAccepting:boolean;includeSoon:boolean;includeInvitation:boolean;loading:boolean;hidden:number;unverified:number;total:number}
export interface OverlayViewModel {matchingOpen?:boolean;closePrivate?:()=>void;displayMode?:OverlayDisplayMode;theme?:OverlayTheme;setDisplayMode?:(mode:OverlayDisplayMode)=>void;setTheme?:(theme:OverlayTheme)=>void;availability?:AvailabilityViewState;setAvailability?:(value:Partial<Pick<AvailabilityViewState,'onlyAccepting'|'includeSoon'|'includeInvitation'>>)=>void;diagnostics?:string;copyDiagnostics?:()=>void;connected:boolean;ended:boolean;busy:boolean;error:string;fields:OverlayFields;catalog:readonly OverlayField[];snapshot?:OverlaySnapshot;records:OverlayRecord[];opacity?:number;collapsed:boolean;setField:(key:string,value:unknown)=>void;search:()=>void;refresh:()=>void;fetchRecords:()=>void;setOpacity?:(value:number)=>void;setCollapsed:(value:boolean)=>void;restore:()=>void;openPrivate:()=>void;endMatching?:()=>void;close:()=>void}
