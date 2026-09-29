# GX1/VOT source variant

This fork carries the TizenTube JavaScript features used by [TizenTubeCobalt_VOT](https://github.com/DrA1ex/TizenTubeCobalt_VOT). The builder repository pins this fork as a submodule, combines its `mods/` bundle with an official Cobalt Android APK, and adds a native translation bridge.

The GX1/VOT changes include an audio and translation menu, Yandex VOT integration, playback quality and speed guards, and startup adjustments. The original TizenBrew and standalone project files remain here so the source history and existing project structure are preserved. Android build instructions, native code, checks, and package releases live in the builder repository.

Audio uses a compact transport menu beside speed controls. Saved rules, languages, volumes, and Yandex sign-in live in TizenTube settings. Session choices only become defaults through an explicit save action.

Playback recovery uses live frame-loss, clock, and buffer telemetry rather than a GX1 workload estimate. Auto responds sooner than fixed quality, and explicitly reselecting a failing resolution returns to normal speed. The builder documents the policy and validation limits in `docs/PLAYBACK-RECOVERY.md`.

This fork is based on [reisxd/TizenTube](https://github.com/reisxd/TizenTube) and retains the project's GPL-3.0 license.
