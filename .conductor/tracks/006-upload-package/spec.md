# Spec: Clean server upload folder

Create upload-ready/ inside this publish directory containing only the latest generated site, local fonts/licenses, compression sidecars and Apache hosting configuration. Use index.html as the package's normal web entry; keep the development entry unchanged. Preserve bytes, relative asset paths and the approved site. Exclude source, tools, agent instructions, task state, evidence, estimates and credentials.

Authorization: user explicitly requests a clean folder of everything to upload. This is local packaging only; no server upload or deployment. No new dependencies. Verify exact file allowlist, asset reference closure, hashes and compression roundtrips; independently review the package. Existing live-host validation and release gates stay separate.
