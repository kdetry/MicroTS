# MicroTS

**TypeScript Syntax. C Semantics. Native Performance.**

MicroTS is an experimental Ahead-of-Time (AOT) compiler that compiles a strict subset of TypeScript directly to native machine code via LLVM.

## Features

- 🚀 **Zero Runtime** - No Node.js, V8, or JavaScript engine required
- ⚡ **Native Performance** - Compiles to machine code via LLVM/Clang
- 🔧 **C Interop** - Call C standard library functions directly
- 📦 **Tiny Binaries** - Output depends only on libc

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

### 1. Create a MicroTS program

```typescript
// hello.ts
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    printf("Hello, World!\n");
    return 0;
}
```

### 2. Compile and run

```bash
npx ts-node src/cmd/main.ts hello.ts --run
```

### 3. Output

```
Compiling: hello.ts
Generated: hello.ll
Compiled: hello

--- Running executable ---
Hello, World!
Exit code: 0
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
| Functions | `function add(a: number, b: number): number { return a + b; }` |
| Variables | `let x: number = 42;` |
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparisons | `<`, `>`, `<=`, `>=`, `==`, `!=` |
| Control Flow | `if`, `else`, `while`, `for` |
| C FFI | `declare function printf(fmt: string, ...args: number[]): number;` |
| Arrays | `let arr: number[] = malloc(20); arr[0] = 10;` |
| Strings | `printf("Hello %d\n", 42);` |

### ❌ Not Supported

- Closures / lambdas
- Classes / prototypes
- Garbage collection
- `try`/`catch`
- Union types (`string | number`)
- `any` type

## Type Mappings

| TypeScript | LLVM |
|------------|------|
| `number` | `i32` |
| `boolean` | `i1` |
| `void` | `void` |
| `string` | `i8*` |
| `number[]` | `i32*` |

## Examples

### Fibonacci

```typescript
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    let a: number = 0;
    let b: number = 1;
    
    for (let i: number = 0; i < 10; i = i + 1) {
        let temp: number = a + b;
        a = b;
        b = temp;
    }
    
    printf("Fibonacci(10) = %d\n", b);
    return b;
}
```

### Arrays with malloc

```typescript
declare function malloc(size: number): number[];
declare function free(ptr: number[]): void;
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    let arr: number[] = malloc(20);  // 5 * 4 bytes
    
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    
    printf("Sum: %d\n", arr[0] + arr[1] + arr[2]);
    
    free(arr);
    return 0;
}
```

## Project Structure

```
src/
├── cmd/main.ts           # CLI entry point
├── compiler/
│   ├── ASTWalker.ts      # TypeScript AST → LLVM IR
│   ├── Emitter.ts        # LLVM IR string builder
│   ├── Context.ts        # Symbol table / scopes
│   └── TypeMapper.ts     # TS types → LLVM types
├── stdlib/libc.ts        # C FFI declarations
└── utils/SystemRunner.ts # Clang execution wrapper
```

## How It Works

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌────────────┐
│ .ts     │ ──▶ │  AST    │ ──▶ │  .ll    │ ──▶ │ executable │
│ source  │     │ (TS API)│     │ (LLVM)  │     │ (native)   │
└─────────┘     └─────────┘     └─────────┘     └────────────┘
                    ▲               ▲                ▲
              TypeScript        Emitter           Clang
              Compiler API      + Walker
```

## License

MIT
