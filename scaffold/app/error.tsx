"use client";
import React from "react";
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="container"><h1>Something interrupted this page.</h1><p>Your saved profile stays in this browser.</p><button onClick={reset}>Try again</button></main>;}
