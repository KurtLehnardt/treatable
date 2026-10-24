import React from 'react';import{createRoot}from'react-dom/client';import{PrivateMatchingView}from'./private-match-view';import{usePrivateMatching}from'./use-private-matching';import'./panel-b.css';import'./panel.css';import'./private-match.css';
function App(){return <PrivateMatchingView vm={usePrivateMatching()}/>}
createRoot(document.getElementById('root')!).render(<App/>);
