import React from 'react';
import { Redirect } from 'expo-router';

// Keep historical production records without exposing a new production workflow.
export default function ProductionRoute() { return <Redirect href="/stock" />; }
