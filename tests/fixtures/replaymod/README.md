# Optional original ReplayMod test excerpt

The genuine recording excerpt is **not bundled in the repository**. Public attachment licensing is unspecified; keep downloads and extracted bytes under the gitignored `output/replaymod-validation/` directory. The parser test uses the local excerpt when present and otherwise skips this one optional case. Independent binary fixtures in the test module run without downloads.

- Public source: [ReplayMod/ReplayMod issue 927](https://github.com/ReplayMod/ReplayMod/issues/927).
- Original attachment: [replay_recordings.zip](https://github.com/ReplayMod/ReplayMod/files/13811595/replay_recordings.zip).
- Attachment member: `1_20_1.mcpr`, generator `ReplayMod v1.20.1-2.6.14`, Java protocol 763, MCPR format 14.
- Original MCPR SHA-256: `273c50d4ddb8cfda640baf3dd19a4ed5962da0608f3912b5b2a5f891c1847391`.
- Locally generated excerpt MCPR SHA-256: `625ebe4ea78fafc49ecf926f9059e9c65577b420d2d0d58621f6f31ff6e0f249`.

The excerpt retains `metaData.json` exactly and the **first 24 packet records** of `recording.tmcpr` byte-for-byte: 244,444 raw bytes, ending at timestamp 423 ms after the first full chunk. Its ZIP is 47,559 bytes. It omits all other members and later records; the original metadata duration (12,434 ms) is deliberately retained, so duration handling can also be checked. Repackaging changes ZIP headers/compression but never packet data.

The records cover ReplayMod login, the real dimension registry, initial position, recorder UUID/entity matching, and a real chunk at (-10,-12), with 1.20.1's palette padding. They do not cover the complete recording's later world mutations.

After downloading and extracting `1_20_1.mcpr` under `output/replaymod-validation/`, run the following as a Node ES module from the project root:

```js
import fs from 'node:fs/promises'
import JSZip from 'jszip'
const base = 'output/replaymod-validation'
const source = await JSZip.loadAsync(await fs.readFile(`${base}/1_20_1.mcpr`))
const raw = await source.file('recording.tmcpr').async('nodebuffer')
let end = 0
for (let record = 0; record < 24; record++) end += 8 + raw.readInt32BE(end + 4)
const excerpt = new JSZip()
excerpt.file('metaData.json', await source.file('metaData.json').async('string'))
excerpt.file('recording.tmcpr', raw.subarray(0, end))
await fs.writeFile(`${base}/issue-927-1.20.1-initial.mcpr`, await excerpt.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
```

ZIP timestamps can differ on regeneration; the decompressed members remain identical. Tests do not download anything. Full-file validation also succeeded for the sibling `1_20_4.mcpr` (protocol 765; SHA-256 `810c8682dce2de278468e693a2cff0df811b8da41438b6c7623a1479f24e4ebf`), including 604 chunks, 1,227 block updates, 258 spawns, and 27 chunk unloads.
