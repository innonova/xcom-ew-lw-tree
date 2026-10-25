# trusted-updates test vectors

A pinned copy of `test-vectors/cases/` and `test-vectors/files/` from
`innonova/trusted-updates` at tag **v0.3.1** (commit
ce73fe0d1084d3321499b694d7dac4c217c1dda0), format 1. The desktop shell's
client (`src/trusted.ts`) must pass every one (`src/trusted.test.ts`).

Nothing here is secret: every key that signed them is derived from a fixed
test seed, and none is a real root key. `older/` (installing an older
release) is not copied: the app does not offer that.

The vectors change only when the format does; a new format is a new number,
announced. To update: copy the folders from the new tag and change the tag
above.
