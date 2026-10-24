import React from'react';import{createRoot}from'react-dom/client';import{captureSiteActivations}from'./overlay-port';import{ScoreBadgeClient}from'./score-badge-client';import'./score-badge.css';
captureSiteActivations(window);createRoot(document.getElementById('root')!).render(<ScoreBadgeClient/>);
