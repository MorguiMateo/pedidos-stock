import React from 'react';
import { Redirect } from 'expo-router';

// Historical purchase data is retained; purchasing is outside this release.
export default function PurchasesRoute() { return <Redirect href="/stock" />; }
