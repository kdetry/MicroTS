# MicroTS

**TypeScript Syntax. C Semantics. Native Performance.**

MicroTS is an experimental Ahead-of-Time (AOT) compiler that compiles a strict subset of TypeScript directly to native machine code via LLVM.

## Features

- 🚀 **Zero Runtime** - No Node.js, V8, or JavaScript engine required
- ⚡ **Native Performance** - Compiles to machine code via LLVM/Clang
- 🔧 **C Interop** - Call C standard library functions directly
- 📦 **Tiny Binaries** - Output depends only on libc
- 📁 **ES Modules** - `import`/`export` support with name mangling
- 🏗️ **Structs** - `interface` maps to LLVM structs with nested access
- 🔨 **Methods** - `this` parameter enables `obj.method()` syntax (UFCS)
- 🔮 **Generics** - Monomorphization of generic interfaces at compile time

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

### With Structs

```typescript
interface Point { x: number; y: number; }
interface Line { start: Point; end: Point; }

function main(): number {
    let line: Line = malloc(sizeof<Line>());
    
    line.start.x = 10;  // Nested field access
    line.start.y = 20;
    
    printf("x=%d, y=%d\n", line.start.x, line.start.y);
    
    free(line);
    return 0;
}
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

### With Generics

```typescript
interface Box<T> {
    id: number;
    value: T;
}

interface Pair<T, U> {
    first: T;
    second: U;
}

function main(): number {
    // Single type parameter
    let intBox: Box<number> = malloc(sizeof<Box<number>>());
    intBox.id = 1;
    intBox.value = 42;
    printf("Box: id=%d, value=%d\n", intBox.id, intBox.value);
    free(intBox);

    // Multiple type parameters
    let pair: Pair<number, number> = malloc(sizeof<Pair<number, number>>());
    pair.first = 10;
    pair.second = 20;
    printf("Pair: first=%d, second=%d\n", pair.first, pair.second);
    free(pair);

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
| **Structs** | `interface Point { x: number; y: number; }` |
| **Generics** | `interface Box<T> { value: T; }` with monomorphization |
| **sizeof** | `sizeof<Point>()` → compile-time size calculation |
| **Nested Access** | `line.start.x = 10;` (arbitrary depth) |
| **Methods** | `function area(this: Rect): number` → `r.area()` |

### ❌ Not Supported

- Closures / lambdas
- Classes / prototypes
- Garbage collection
- `try`/`catch`
- Union types (`string | number`)
- `any` type

## Struct System

TypeScript `interface` maps directly to LLVM `struct`:

```typescript
interface Vector3 {
    x: number;
    y: number;
    z: number;
}

let vec: Vector3 = malloc(sizeof<Vector3>());  // 12 bytes
vec.x = 10;
vec.y = 20;
vec.z = 30;
let sum: number = vec.x + vec.y + vec.z;
free(vec);
```

**Generated LLVM IR:**
```llvm
%Vector3 = type { i32, i32, i32 }
; sizeof<Vector3>() = 12
```

**Features:**
- Compile-time `sizeof<T>()` intrinsic
- Nested struct access: `line.start.x`
- Heap allocation via `malloc`/`free`
- Field read/write via `getelementptr`

## Method System (UFCS)

Functions with `this` as the first parameter become methods:

```typescript
interface Rect {
    width: number;
    height: number;
}

// "this: Rect" makes this a method on Rect
function area(this: Rect): number {
    return this.width * this.height;
}

function scale(this: Rect, factor: number): void {
    this.width = this.width * factor;
    this.height = this.height * factor;
}

function main(): number {
    let r: Rect = malloc(sizeof<Rect>());
    r.width = 10;
    r.height = 20;
    
    r.scale(2);         // UFCS: compiles to scale(r, 2)
    let a = r.area();   // UFCS: compiles to area(r)
    
    printf("Area: %d\n", a);  // 800
    free(r);
    return 0;
}
```

**How it works:**
- `function area(this: Rect)` → `@Rect_area(%Rect* %this)`
- `r.area()` → `call @Rect_area(%Rect* %r)`
- Static dispatch (no vtables), compile-time resolution

## Generic System

Generic interfaces are instantiated at compile time via **monomorphization**:

```typescript
interface Box<T> {
    id: number;
    value: T;
}

let intBox: Box<number> = malloc(sizeof<Box<number>>());
let numPair: Pair<number, number> = malloc(sizeof<Pair<number, number>>());
```

**Generated LLVM IR:**
```llvm
%Box_i32 = type { i32, i32 }
%Pair_i32_i32 = type { i32, i32 }
```

**Features:**
- Single type parameters: `Box<number>` → `Box_i32`
- Multiple type parameters: `Pair<i32, f64>` → `Pair_i32_f64`
- Nested generics: `Box<Box<number>>` → `Box_Box_i32`
- Type name mangling: `T` replaced with concrete types
- Zero runtime overhead (all generics resolved at compile time)

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
| `interface X` | `%X*` (pointer to struct) |
| `Box<number>` | `%Box_i32*` (mangled generic) |
| `Pair<T, U>` | `%Pair_T_U*` (instantiated struct) |

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
| `10-structs` | Interfaces & nested structs |
| `11-methods` | Method syntax (UFCS) |
| `12-generics` | Generic interfaces (monomorphization) |
| `12a-generics-advanced` | Multiple type parameters |
| `12b-generics-nested` | Nested generic types |

## Project Structure

```
src/
├── cmd/main.ts             # CLI entry point
├── compiler/
│   ├── ASTWalker.ts        # TypeScript AST → LLVM IR
│   ├── Emitter.ts          # LLVM IR string builder
│   ├── Context.ts          # Symbol table / scopes
│   ├── TypeMapper.ts       # TS types → LLVM types
│   ├── TypeResolver.ts     # Generic type parsing
│   ├── ModuleResolver.ts   # Import/export resolution
│   ├── GenericRegistry.ts  # Generic blueprint storage
│   └── StructRegistry.ts   # Interface → struct mapping
├── stdlib/libc.ts          # C FFI declarations (auto-loaded)
└── utils/SystemRunner.ts   # Clang execution wrapper
```

## How It Works

```
┌──────────┐     ┌───────────────┐     ┌─────────┐     ┌────────────┐
│  main.ts │ ──▶ │ GenericRegistry│ ──▶ │  .ll    │ ──▶ │ executable │
│          │     │ StructRegistry│     │ (LLVM)  │     │ (native)   │
└──────────┘     │   ASTWalker   │     └─────────┘     └────────────┘
                 └───────────────┘           │
                        │                 Monomorphization
                  Generic Types          Box<number> → Box_i32
                  interface Box<T>       Pair<T,U> → Pair_i32_i32
```

## License

MIT
