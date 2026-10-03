---
name: metrica-report
description: Pull a traffic or conversion report from Yandex Metrica: pick the counter and goals, request one wide period, and read dimensions and metrics without double-counting.
---

# Yandex Metrica MCP

## What this server covers

Read-only Yandex Metrica web analytics: list counters and goals, and pull traffic and
conversion statistics. There is nothing to write here — this server cannot change a
counter, a goal or a setting.

## Start from the counter

Resolve the counter first and state which one the numbers come from. An account often has
several counters for the same site, and mixing them silently produces numbers that look
plausible and are wrong.

## One wide period

Request a single wide date range rather than looping over days. The API aggregates server
side, and a day-by-day loop costs more and invites double-counting when you sum the parts.

## Goals and conversions

A conversion only means something next to the goal it was counted against. Name the goal
whenever you report a conversion figure, and do not add conversions across goals that can
both fire on one visit.

## Sessions versus users

Metrica counts visits and users separately, and they do not add up. Pick the one the
question asks about and say which one you used.

