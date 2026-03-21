# Voice + Presence Co-Pilot Spec

## Problem

Voice paths and presence behavior can become inconsistent across channels.

## Goal

Ensure one coherent identity across typed, spoken, PTT, and summary pathways.

## Scope

- voice route selection
- fallback handling
- identity/voice mapping
- channel parity checks

## Co-Pilot Capabilities

- inspect active voice route and fallback route
- diagnose wrong-voice / duplicate-output / missing-audio issues
- propose configuration fixes
- run channel consistency checks

## Required UI

- voice route inspector
- fallback diagnostics timeline
- identity consistency status card

## Acceptance Criteria

1. Operator can see which route produced each spoken output.
2. Fallback behavior is auditable and explainable.
3. Identity is consistent across supported channels.

## Test Plan

- integration: route/fallback event tracing
- e2e: chat vs PTT voice parity checks
