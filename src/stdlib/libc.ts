/**
 * libc.ts - TypeScript declarations for C standard library functions
 * 
 * These are "declare" statements that tell MicroTS about external C functions
 * that will be linked at compile time. They don't have implementations in TS.
 * 
 * Note: Use "string" type for C string parameters (i8*)
 */

// Standard I/O
declare function printf(format: string, ...args: number[]): number;
declare function puts(str: string): number;
declare function putchar(c: number): number;

// Memory allocation
declare function malloc(size: number): number[];
declare function free(ptr: number[]): void;
declare function memset(ptr: number[], value: number, size: number): number[];
declare function memcpy(dest: number[], src: number[], size: number): number[];

// Process control
declare function exit(status: number): void;

// Math functions (from libm)
declare function abs(x: number): number;
