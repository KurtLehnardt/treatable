import {createContext} from 'react';
/** Lets a section inside the overlay open the Settings panel at "Your details". Provided by OverlayView. */
export const OpenSettingsContext=createContext<(()=>void)|undefined>(undefined);
