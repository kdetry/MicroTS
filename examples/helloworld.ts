// Hello World - tests C FFI with printf
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    printf("Hello, World!\\n");
    printf("The answer is: %d\\n", 42);
    printf("Math: %d + %d = %d\\n", 10, 20, 30);
    return 0;
}
