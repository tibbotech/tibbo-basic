# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Tibbo Basic compiler implemented in TypeScript/JavaScript. The goal is to produce byte-for-byte identical opcodes to the reference C++ compiler (tmake). It also ships as a VSCode language server extension.

**Reference implementations (C++):**
- Language: `tide/src/tblang`
- Linker: `tide/src/tlink`
- Compiler/project builder: `tide/src/tmake`
- Debug symbols / object format: `tide/src/tobj`

Always inspect the reference C++ implementation when adding or fixing compiler behavior.

## Commands

All commands run from `server/`:

```bash
cd server
npm run build        # compile TypeScript
npm run watch        # incremental watch build
npm test             # run all Jest tests
npx jest --testPathPattern=<name>   # run a single test file, e.g. compiler.test.ts
npx jest -t "<test name>"           # run a specific test by name
npm run compile      # compile a Tibbo project via CLI (node out/compiler/compile-project.js)
npm run dump-pdb     # disassemble a .pdb/.tpc file
```

## Compiler Pipeline

`server/src/compiler/` contains the full pipeline, exposed via `index.ts`:

1. **Parse** (`index.ts: parse`) — ANTLR4 lexer/parser from generated grammar in `server/language/TibboBasic/lib/`. Produces a parse tree.
2. **AST** (`ast/builder.ts`, `ast/nodes.ts`) — Walks the ANTLR parse tree and produces a typed AST.
3. **Semantic resolution** (`semantics/resolver.ts`) — Resolves symbols, scopes, event numbers, and builds a symbol table.
4. **Type checking** (`semantics/checker.ts`) — Type inference and validation over the AST.
5. **Code generation** (`codegen/generator.ts`, `codegen/emitter.ts`, `codegen/opcodes.ts`) — Emits Tibbo P-code opcodes into an `Emitter` buffer.
6. **TOBJ writer** (`tobj/writer.ts`, `tobj/format.ts`) — Serializes emitter output into a `.tbs.obj` binary (TOBJ format).
7. **Linker** (`linker/linker.ts`) — Links one or more `.tbs.obj` files into a final `.tpc` binary.

**Project-level compilation** (multi-file, reads `.tpr` project files) lives in `compiler/project.ts` (`ProjectCompiler`).

## Tests

- `server/tests/compiler/tmake-js-opcode-parity.test.ts` — **Primary parity test.** For each project under `server/tests/compiletests/`, runs the C++ tmake compiler and the JS compiler and asserts identical opcodes in the Code section of the TBIN/PDB output. This is the ground-truth test for correctness.
- `server/tests/compiler/compiler.test.ts` — Unit/integration tests for individual compiler behaviors.
- `server/tests/parser.test.ts` / `preprocessor.test.ts` — Parser and preprocessor tests.
- `server/tests/errortests/errors.test.ts` — Error diagnostic tests.

Test fixtures (Tibbo projects) are in `server/tests/compiletests/<name>/` and `server/tests/blank/`.

## Key Notes

- Opcodes must match the C++ reference exactly. Use `disassembleBinaryToLines` / `disassembleBinarySectionToLines` (in `compiler/dump-pdb-instructions.ts`) to compare output when debugging parity failures.
- The `CompileOptions.flags` bitmask controls features: bit 1 = 24-bit code addressing, bit 2 = 32-bit data addressing.
- TOBJ format constants and section types are defined in `tobj/format.ts`.
- Platform configuration (code/data bit widths, max event number) comes from `.tpr`/platform INI files and flows into `CompileOptions`.
