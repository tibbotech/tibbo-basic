# Opcode parity catalog

Projects under [`compiletests/`](compiletests/) are compiled by both the reference Tibbo toolchain (tmake via AppBlocks API) and the JS [`ProjectCompiler`](../src/compiler/project.ts). The Jest suite [`compiler/tmake-js-opcode-parity.test.ts`](./compiler/tmake-js-opcode-parity.test.ts) discovers every immediate subdirectory that contains a `.tpr`, then asserts identical disassembly of the **Code** section (TBIN/PDB).

Requires network access for the reference build. Platform files come from the repo `platforms/Platforms` tree when a project has no local `Platforms/` folder.

| Folder | What it exercises | Key files |
|--------|-------------------|-----------|
| `simple` | Minimal `on_sys_init`, `sys.debugprint` | `main.tbs`, `global.tbh`, `blank.tpr` |
| `datatypes` | Scalars: char, byte, short, word, long, dword, float, real, string, boolean | `main.tbs`, `global.tbh`, `blank.tpr` |
| `functions` | `function` return value, sub calls | `main.tbs`, `global.tbh`, `blank.tpr` |
| `functionparam` | `byref` / `byval`, string concat, nested calls | `main.tbs`, `global.tbh`, `blank.tpr` |
| `byref` | `byref string` through sub + function | `main.tbs`, `global.tbh`, `blank.tpr` |
| `stringsize` | `string(N)` dimensions, globals | `main.tbs`, `global.tbh`, `blank.tpr` |
| `array` | Module-level array `dim`, indexing | `main.tbs`, `global.tbh`, `blank.tpr` |
| `forloop` | `for` / `next`, negative `step`, `#define` in bounds | `main.tbs`, `global.tbh`, `blank.tpr` |
| `forlooparray` | `for` + array load/store + `str` | `main.tbs`, `global.tbh`, `blank.tpr` |
| `modules` | Second compilation unit `boot.tbs`, `boot()` | `main.tbs`, `boot.tbs`, `global.tbh`, `blank.tpr` |
| `modules2` | `boot.tbs` with `multiply` / `divide`, word ops across files | `main.tbs`, `boot.tbs`, `global.tbh`, `blank.tpr` |
| `controlflow` | `if` / `else if` / `else`, `while` / `wend`, `do` / `loop`, `select case` | `main.tbs`, `global.tbh`, `blank.tpr` |
| `enumconst` | `enum`, `const` in expressions and `for` bounds | `main.tbs`, `global.tbh`, `blank.tpr` |
| `structtype` | `type` … `end type`, `dim`, field read/write | `main.tbs`, `global.tbh`, `blank.tpr` |
| `operators` | `mod`, bitwise `and` / `or` / `xor` / `not`, `shl` / `shr` | `main.tbs`, `global.tbh`, `blank.tpr` |
| `syscalls` | `sys` getters/setters (`timercount`, `runmode`, `timercount32`, `onsystimerperiod`, `wdperiod`), `str`/`lstr`/`stri`/`hex`, folded `chr`, nested `str(val(var))` (tmake uses `LEA` at str output temp + one `TEMP_STRING_SLOT_SIZE` for `val`'s byref + matching `LOA16I`), void `sys.halt` (no `sys.sleep` on this platform) | `main.tbs`, `global.tbh`, `blank.tpr` |
