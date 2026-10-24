import React from "react";
import type { Metadata } from "next";
import { BRAND, BRAND_TAGLINE } from "@/lib/brand";
import "./globals.css";
export const metadata: Metadata = { title: `${BRAND} — ${BRAND_TAGLINE}`, description: "Find clinical studies and expanded-access programs for pain and hard-to-control symptoms. Clear information for you and your care team." };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
