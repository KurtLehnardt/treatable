"use client";
import React from "react";
export default function GlobalError({reset}:{reset:()=>void}){return <html lang="en"><body><main><h1>Treatable could not open this page.</h1><button onClick={reset}>Try again</button></main></body></html>;}
