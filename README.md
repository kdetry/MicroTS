# MicroTS

**TypeScript Syntax. C Semantics. Native Performance.**

MicroTS is an experimental Ahead-of-Time (AOT) compiler that compiles a strict subset of TypeScript directly to native machine code via LLVM.

## Features

- 🚀 **Zero Runtime** - No Node.js, V8, or JavaScript engine required
- ⚡ **Native Performance** - Compiles to machine code via LLVM/Clang
- 🔧 **C Interop** - Call C standard library functions directly
- 📦 **Tiny Binaries** - Output depends only on libc
- 📁 **ES Modules** - `import`/`export` support with name mangling

## Requirements

- **Node.js** 18+ (for running the compiler)
- **Clang** (for compiling LLVM IR to native code)

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install clang

# Verify installation
clang --version
```

## Installation

```bash
git clone https://github.com/yourusername/ts-aot-compiler.git
cd ts-aot-compiler
npm install
```

## Quick Start

### Simple Program

```typescript
// hello.ts - No imports needed, stdlib is auto-loaded
function main(): number {
    printf("Hello, World!\n");
    return 0;
}
```

```bash
npx ts-node src/cmd/main.ts hello.ts --run
```

### With Modules

```typescript
// math.ts
export function add(a: number, b: number): number {
    return a + b;
}

// main.ts
import { add } from './math';

function main(): number {
    printf("Result: %d\n", add(10, 20));
    return 0;
}
```

```bash
npx ts-node src/cmd/main.ts main.ts --run
```

## CLI Options

```bash
npx ts-node src/cmd/main.ts <input.ts> [options]

Options:
  --emit-llvm    Only emit LLVM IR (.ll file), don't compile
  --run          Run the executable after compilation
  -o <file>      Specify output path
```

## Language Support

### ✅ Supported

| Feature | Example |
|---------|---------|
| Functions | `function add(a: number, b: number): number { ... }` |
| Variables | `let x: number = 42;` |
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparisons | `<`, `>`, `<=`, `>=`, `==`, `!=` |
| Control Flow | `if`, `else`, `while`, `for` |
| C FFI | `printf`, `malloc`, `free` (auto-loaded) |
| Arrays | `let arr: number[] = malloc(20); arr[0] = 10;` |
| Strings | `printf("Hello %d\n", 42);` |
| **Modules** | `import { add } from './math'; export function add(...) {}` |

### ❌ Not Supported

- Closures / lambdas
- Classes / prototypes
- Garbage collection
- `try`/`catch`
- Union types (`string | number`)
- `any` type

## Module System

MicroTS supports ES module imports with **name mangling**:

```typescript
// math.ts
export function add(a: number, b: number): number { return a + b; }
// → Compiles to: @math_add in LLVM IR

// main.ts
import { add } from './math';
add(1, 2);  // → call i32 @math_add(i32 1, i32 2)
```

**Features:**
- Automatic dependency resolution
- Circular import detection
- All modules compile into a single `.ll` file
- `main()` is the entry point (never mangled)

## Type Mappings

| TypeScript | LLVM |
|------------|------|
| `number` | `i32` |
| `boolean` | `i1` |
| `void` | `void` |
| `string` | `i8*` |
| `number[]` | `i32*` |

## Examples

Located in `examples/`:

| Folder | Description |
|--------|-------------|
| `01-hello` | Return value |
| `02-math` | Arithmetic |
| `03-fibonacci` | While loop |
| `04-helloworld` | printf |
| `05-control-flow` | if/else |
| `06-forloop` | For loop |
| `07-arrays` | malloc/free |
| `08-multifile` | Legacy multi-file |
| `09-modules` | ES module imports |

## Project Structure

```
src/
├── cmd/main.ts             # CLI entry point
├── compiler/
│   ├── ASTWalker.ts        # TypeScript AST → LLVM IR
│   ├── Emitter.ts          # LLVM IR string builder
│   ├── Context.ts          # Symbol table / scopes
│   ├── TypeMapper.ts       # TS types → LLVM types
│   └── ModuleResolver.ts   # Import/export resolution
├── stdlib/libc.ts          # C FFI declarations (auto-loaded)
└── utils/SystemRunner.ts   # Clang execution wrapper
```

## How It Works

```
┌──────────┐     ┌───────────────┐     ┌─────────┐     ┌────────────┐
│  main.ts │ ──▶ │ ModuleResolver│ ──▶ │  .ll    │ ──▶ │ executable │
│  math.ts │     │ + ASTWalker   │     │ (LLVM)  │     │ (native)   │
└──────────┘     └───────────────┘     └─────────┘     └────────────┘
                        │
                   Name Mangling
                   math.add → @math_add
```

## License

MIT
