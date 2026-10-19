# Fans Reserve presentation edits

The original editable project is not in this repository. This HyperFrames source corrects the Follow → Subscribe → Reserve scene and adds a six-second 1:1 video-call scene after Reserve experiences, before the existing brand outro. The ten MP4 variants cover horizontal and vertical formats in Spanish, English, Portuguese, French and Italian. Subscriptions describe exclusive content; Reserve Event and Reserve 1:1 remain separate experiences.

The originals are silent, 31.6 seconds at 30 fps, in 1280×720 and 720×1280. Outputs are 36.2 seconds (1,086 frames). The subscription replacement runs from 19.2 to 25.0 seconds. The new call scene starts at 28.2 seconds, followed by the original brand outro from 33.8 seconds. Every transition is a 0.4-second crossfade. Encoding is H.264 CRF 18 with fast-start metadata.

The call uses the existing licensed makeup example as its creator feed and a crop of the illustrative fan feed already present in the original film. Neither person is identified as a Fans Reserve creator. The fan crop is retimed from 3.2 to 6 seconds, silently. No new third-party footage is downloaded.

## Rebuild

Requires Node 22+, the app dependencies (`npm ci` at repository root), and the packages in this directory (`npm install`). Use an untouched copy of `public/presentacion` from commit `0378e77ca8b07b7165602d1da02326b1d266126c` as `--originals`. Do not use the already corrected outputs as source.

```sh
node design/presentation-correction/render.mjs --originals /path/to/originals --out /path/to/output --work /path/to/work
```

`--tools /path/to/tools` optionally points to another directory containing the pinned tool dependencies in `node_modules`. HyperFrames may use `HYPERFRAMES_BROWSER_PATH` for a locally installed Chrome; Chrome Headless Shell is recommended for rendering. The script prepares the fan crop, validates both compositions per variant, renders the scenes, then splices and probes every final video. Outputs include the ten MP4s and a manifest with hashes, dimensions, frame rates, durations, subscription labels and closing headlines.

To retry a single language after an interrupted render, use the same output directory and add `--lang it` (or the relevant language code). Add `--shape vertical` or `--shape horizontal` to retry one format. This preserves the other manifest entries.

The input folder is read-only. Review the outputs before copying them to `public/presentacion`. Original posters have no subscription promise and are retained. The React component's asset version must be bumped when replacing films so cached videos refresh.

See `DESIGN.md` for the established identity and motion rules. These are local tooling dependencies, separate from the website's dependencies.
